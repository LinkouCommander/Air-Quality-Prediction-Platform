// clean-measurements.js
// for cleaning the hourlymeasurements collection

const { MongoClient } = require('mongodb');
require('dotenv').config();

// get the MongoDB connection string from the environment variable
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('error: missing the necessary environment variable MONGO_URI');
  console.error('please set these environment variables or create a .env file');
  process.exit(1);
}

async function cleanMeasurements() {
  let client;
  
  try {
    console.log('Try to connect to MongoDB...');
    client = new MongoClient(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    await client.connect();
    console.log('Successfully connected to MongoDB');
    
    const db = client.db();
    const measurementCollection = db.collection('hourlymeasurements');
    
    // get the current number of records
    const count = await measurementCollection.countDocuments();
    console.log(`There are ${count} records in the hourlymeasurements collection`);
    
    // clear the collection
    console.log('Start to clear the hourlymeasurements collection...');
    const result = await measurementCollection.deleteMany({});
    
    console.log(`✅ Successfully cleared the hourlymeasurements collection, deleted ${result.deletedCount} records`);
    
    // optional: reset the progress tracking collection
    const progressCollection = db.collection('lambjobprogress');
    await progressCollection.deleteMany({});
    console.log('Successfully reset the progress tracking collection');
    
    return { success: true, deletedCount: result.deletedCount };
  } catch (error) {
    console.error('error:', error);
    return { success: false, error: error.message };
  } finally {
    if (client) {
      await client.close();
      console.log('MongoDB connection closed');
    }
  }
}

// execute the clean operation
cleanMeasurements()
  .then(result => {
    if (result.success) {
      console.log('The clean operation is completed. Now you can run the Lambda function to test the data collection');
    } else {
      console.error('The clean operation failed:', result.error);
    }
  })
  .catch(err => {
    console.error('The script execution failed:', err);
  }); 