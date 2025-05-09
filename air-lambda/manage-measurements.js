// manage-measurements.js
// A script for managing the hourlymeasurements collection

const { MongoClient } = require('mongodb');
require('dotenv').config();

// Get the MongoDB connection string from the environment variable
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('Error: Missing the necessary environment variable MONGO_URI');
  console.error('Please set these environment variables or create a .env file');
  process.exit(1);
}

async function connectToMongo() {
  console.log('Connecting to MongoDB...');
  const client = new MongoClient(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
  
  await client.connect();
  console.log('Successfully connected to MongoDB');
  return client;
}

async function countMeasurements() {
  let client;
  
  try {
    client = await connectToMongo();
    const db = client.db();
    const measurementCollection = db.collection('hourlymeasurements');
    
    // Get the current number of records
    const count = await measurementCollection.countDocuments();
    console.log(`There are ${count} records in the hourlymeasurements collection`);
    
    // 按小时统计数据
    const hourlyStats = await measurementCollection.aggregate([
      {
        $group: {
          _id: { 
            year: { $year: "$timestamp" },
            month: { $month: "$timestamp" },
            day: { $dayOfMonth: "$timestamp" },
            hour: { $hour: "$timestamp" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1, "_id.hour": 1 } },
      { $limit: 10 }
    ]).toArray();
    
    console.log('\nRecent 10 hours data statistics:');
    hourlyStats.forEach(stat => {
      console.log(`${stat._id.year}-${stat._id.month}-${stat._id.day} ${stat._id.hour}:00 - ${stat.count} records`);
    });
    
    return { success: true, count };
  } catch (error) {
    console.error('Execution error:', error);
    return { success: false, error: error.message };
  } finally {
    if (client) {
      await client.close();
      console.log('MongoDB connection closed');
    }
  }
}

async function cleanMeasurements(confirmation) {
  if (confirmation !== 'confirm') {
    console.error('Error: Must provide the confirmation parameter "confirm" to clear the data');
    console.error('Usage: node manage-measurements.js clean confirm');
    return { success: false, error: 'Missing confirmation' };
  }
  
  let client;
  
  try {
    client = await connectToMongo();
    const db = client.db();
    const measurementCollection = db.collection('hourlymeasurements');
    
    // 获取当前记录数
    const count = await measurementCollection.countDocuments();
    console.log(`There are ${count} records in the hourlymeasurements collection`);
    
    // 清空集合
    console.log('Starting to clear the hourlymeasurements collection...');
    const result = await measurementCollection.deleteMany({});
    
    console.log(`Successfully cleared the hourlymeasurements collection, deleted ${result.deletedCount} records`);
    
    // 重置进度跟踪集合
    const progressCollection = db.collection('lambjobprogress');
    await progressCollection.deleteMany({});
    console.log('Progress tracking collection reset');
    
    return { success: true, deletedCount: result.deletedCount };
  } catch (error) {
    console.error('Execution error:', error);
    return { success: false, error: error.message };
  } finally {
    if (client) {
      await client.close();
      console.log('MongoDB connection closed');
    }
  }
}

// Parse the command line parameters
const args = process.argv.slice(2);
const command = args[0] || 'count';
const param = args[1];

// Execute different operations based on the command
if (command === 'clean') {
  cleanMeasurements(param)
    .then(result => {
      if (result.success) {
        console.log('Clearing operation completed. Now you can run the Lambda function to test data collection');
      } else {
        console.error('Clearing operation failed:', result.error);
      }
    })
    .catch(err => {
      console.error('Script execution failed:', err);
    });
} else if (command === 'count') {
  countMeasurements()
    .then(result => {
      if (result.success) {
        console.log('Statistics operation completed');
      } else {
        console.error('Statistics operation failed:', result.error);
      }
    })
    .catch(err => {
      console.error('Script execution failed:', err);
    });
} else {
  console.log('Unknown command:', command);
  console.log('Usage:');
  console.log('  node manage-measurements.js count      - View the number of records');
  console.log('  node manage-measurements.js clean confirm - Clear the collection');
} 