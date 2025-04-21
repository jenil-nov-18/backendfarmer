const mongoose = require('mongoose');

const MONGO_URI = 'mongodb+srv://jeniltrambadiya242:7o0CU3vQlK0kq4vS@cluster0.q4o0ie0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch((err) => console.error('MongoDB connection error:', err));

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, required: true },
  price: { type: Number, required: true },
  category: { type: String, required: true },
  stockQuantity: { type: Number, required: true },
  image: { type: String, required: true },
  seller: {
    id: { type: String, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
  },
  discount: { type: Number, default: 0 },
  visibility: {
    type: String,
    enum: ['unpublished', 'public', 'draft'],
    default: 'unpublished',
  },
  status: { type: String, enum: ['draft', 'published', 'unpublished', 'deleted'], default: 'draft' },
  rating: { type: Number, default: 0 },
  reviews: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  isNew: { type: Boolean, default: false },
  featured: { type: Boolean, default: false },
});

const Product = mongoose.model('Product', productSchema);

const migrateVisibilityField = async () => {
  const Product = mongoose.model('Product', productSchema);

  try {
    const products = await Product.find({});

    for (const product of products) {
      if (product.visibility === 'public') {
        product.isPublic = true;
      } else if (product.visibility === 'unpublished') {
        product.isPublic = false;
      }
      await product.save();
    }

    console.log('Migration completed: visibility field synchronized with isPublic.');
  } catch (error) {
    console.error('Error during migration:', error);
  }
};

migrateVisibilityField();

module.exports = Product;