// server.js
const express = require('express');
const Razorpay = require('razorpay');
const cors = require('cors');
const path = require('path');
const { Clerk } = require('@clerk/clerk-sdk-node');
const Product = require('./db');
require('dotenv').config();

const app = express();
app.use(cors({origin: ['http://localhost:8080','https://farmersellingproduct.vercel.app']}));
app.use(express.json());

// Initialize Clerk and Razorpay
const clerk = new Clerk({ secretKey: process.env.CLERK_SECRET_KEY });
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_SECRET
});

// Validation helpers
const validateAmount = (amount) => {
  if (typeof amount !== 'number') return false;
  if (isNaN(amount) || !isFinite(amount)) return false;
  return amount > 0;
};

const validateUserId = (userId) => {
  return typeof userId === 'string' && userId.trim().length > 0;
};

const validateMetadata = (metadata) => {
  if (!metadata || typeof metadata !== 'object') return false;
  const requiredFields = ['businessName', 'phoneNumber', 'address', 'description'];
  return requiredFields.every(field => 
    metadata[field] && typeof metadata[field] === 'string' && metadata[field].trim().length > 0
  );
};

// Error handler middleware
const errorHandler = (err, req, res, next) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    code: err.code || 'INTERNAL_ERROR'
  });
};

// Async handler wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Create Razorpay order
app.post('/create-order', asyncHandler(async (req, res) => {
  const { amount } = req.body;

  if (!validateAmount(amount)) {
    return res.status(400).json({
      error: 'Invalid amount',
      code: 'INVALID_AMOUNT'
    });
  }

  try {
    const order = await razorpay.orders.create({
      amount: Math.round(amount), // Convert to smallest currency unit
      currency: 'INR',
      receipt: `receipt_${Date.now()}`,
      payment_capture: 1
    });

    res.json({ 
      orderId: order.id,
      amount: order.amount,
      currency: order.currency
    });
  } catch (error) {
    console.error('Razorpay order creation error:', error);
    throw {
      status: 502,
      message: 'Failed to create payment order',
      code: 'PAYMENT_GATEWAY_ERROR'
    };
  }
}));

// Seller metadata update
app.post('/update-seller', asyncHandler(async (req, res) => {
  const { userId, metadata } = req.body;

  if (!validateUserId(userId)) {
    return res.status(400).json({
      error: 'Invalid user ID',
      code: 'INVALID_USER_ID'
    });
  }

  if (!validateMetadata(metadata)) {
    return res.status(400).json({
      error: 'Invalid seller metadata',
      code: 'INVALID_METADATA'
    });
  }

  try {
    // Verify user exists
    const user = await clerk.users.getUser(userId);
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Update user metadata
    await clerk.users.updateUserMetadata(userId, {
      publicMetadata: {
        ...metadata,
        updatedAt: new Date().toISOString()
      }
    });

    res.json({
      success: true,
      message: 'Seller metadata updated successfully'
    });
  } catch (error) {
    console.error('Clerk metadata update error:', error);
    if (error.status === 404) {
      throw {
        status: 404,
        message: 'User not found',
        code: 'USER_NOT_FOUND'
      };
    }
    throw {
      status: 502,
      message: 'Failed to update seller information',
      code: 'CLERK_API_ERROR'
    };
  }
}));

// Payment verification webhook
app.post('/verify-payment', asyncHandler(async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature
  } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({
      error: 'Missing payment verification parameters',
      code: 'INVALID_PAYMENT_VERIFICATION'
    });
  }

  try {
    // Verify payment signature
    const isValid = razorpay.webhooks.verifyPaymentSignature({
      order_id: razorpay_order_id,
      payment_id: razorpay_payment_id,
      signature: razorpay_signature
    });

    if (!isValid) {
      return res.status(400).json({
        error: 'Invalid payment signature',
        code: 'INVALID_SIGNATURE'
      });
    }

    res.json({
      success: true,
      message: 'Payment verified successfully'
    });
  } catch (error) {
    console.error('Payment verification error:', error);
    throw {
      status: 400,
      message: 'Payment verification failed',
      code: 'VERIFICATION_FAILED'
    };
  }
}));

// Product CRUD operations

// Create a new product
app.post('/api/products', async (req, res) => {
  try {
    console.log('Incoming product data:', req.body); // Log incoming data

    // Ensure visibility is set to 'unpublished' if not provided
    const productData = {
      ...req.body,
      visibility: req.body.visibility || 'unpublished',
    };

    const product = new Product(productData);
    await product.save();

    console.log('Product successfully created:', product); // Log success
    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product: product.toObject(), // Explicitly send the created product
    });
  } catch (error) {
    console.error('Error creating product:', error); // Log error
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// Get all products
app.get('/api/products', async (req, res) => {
  try {
    const { sellerId, visibility } = req.query;

    // Build the query dynamically based on the provided query parameters
    const query = {};
    if (sellerId) query['seller.id'] = sellerId;
    if (visibility) query.visibility = visibility;

    const products = await Product.find(query);
    res.status(200).json(products);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Get a single product by ID
app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.status(200).json(product);
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// Update a product
app.put('/api/products/:id', async (req, res) => {
  try {
    console.log('Received request to update product:', req.params.id, req.body); // Debugging log

    const { visibility, ...updateData } = req.body;

    // Ensure updatedAt is set to the current date
    updateData.updatedAt = new Date();

    // Explicitly handle visibility changes
    if (visibility) {
      updateData.visibility = visibility;
    }

    console.log('Update data prepared for database:', updateData); // Debugging log

    const product = await Product.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!product) {
      console.error('Product not found:', req.params.id); // Debugging log
      return res.status(404).json({ error: 'Product not found' });
    }

    console.log('Product updated successfully:', product); // Debugging log
    res.status(200).json(product);
  } catch (error) {
    console.error('Error updating product:', error); // Debugging log
    res.status(500).json({ error: 'Failed to update product', details: error.message });
  }
});

// Delete a product
app.delete('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.status(200).json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// Serve frontend in production
// if (process.env.NODE_ENV === 'production') {
//   app.use(express.static(path.join(__dirname, '../agro-learn-commerce/dist')));
//   app.get('*', (req, res) => {
//     res.sendFile(path.join(__dirname, '../agro-learn-commerce/dist/index.html'));
//   });
// }

// Register error handler
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  
});
