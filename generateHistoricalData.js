import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';

// load environment variables
dotenv.config({ path: '../.env' });

// MongoDB connection URI
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('error: MONGO_URI is not set');
  process.exit(1);
}

// 定义模型
const StationSchema = new mongoose.Schema({
  id: String,
  name: String,
  coordinates: {
    latitude: Number,
    longitude: Number
  },
  sensors: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Sensor' }]
});

const SensorSchema = new mongoose.Schema({
  id: String,
  name: String,
  parameter: {
    id: Number,
    name: String,
    units: String,
    displayName: String
  },
  station: { type: mongoose.Schema.Types.ObjectId, ref: 'Station' }
});

const HourlyMeasurementSchema = new mongoose.Schema({
  station: { type: mongoose.Schema.Types.ObjectId, ref: 'Station', required: true },
  parameter: {
    id: Number,
    name: String,
    units: String,
    displayName: String
  },
  value: { type: Number, required: true },
  timestamp: { type: Date, required: true },
}, { timestamps: true });

// 创建索引
HourlyMeasurementSchema.index({ station: 1, timestamp: 1 });
HourlyMeasurementSchema.index({ timestamp: 1 });
HourlyMeasurementSchema.index({ 'parameter.name': 1 });
HourlyMeasurementSchema.index({ 'station': 1, 'timestamp': 1, 'parameter.name': 1 });

// 创建模型
const Station = mongoose.model('Station', StationSchema);
const Sensor = mongoose.model('Sensor', SensorSchema);
const HourlyMeasurement = mongoose.model('HourlyMeasurement', HourlyMeasurementSchema);

// function to generate random air quality data (return a value in the reasonable range based on the parameter type)
function generateRandomValue(paramName) {
  const ranges = {
    'pm25': { min: 0, max: 300 },
    'pm10': { min: 0, max: 500 },
    'o3': { min: 0, max: 250 },
    'no2': { min: 0, max: 200 },
    'so2': { min: 0, max: 150 },
    'co': { min: 0, max: 30 }
  };

  const range = ranges[paramName] || { min: 0, max: 100 };
  return parseFloat((Math.random() * (range.max - range.min) + range.min).toFixed(2));
}

// function to log messages to a file
async function logToFile(message) {
  const logFile = 'data_generation.log';
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${message}\n`;
  
  console.log(message);
  
  try {
    await fs.appendFile(logFile, logMessage);
  } catch (err) {
    console.error('error when writing to the log file:', err);
  }
}

// main function
async function generateHistoricalData() {
  try {
    await logToFile('start to connect to MongoDB...');
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    await logToFile('✅ MongoDB connection success');

    // clear the existing hourly measurement data
    await logToFile('clear the existing hourly measurement data...');
    await HourlyMeasurement.deleteMany({});
    await logToFile('✅ clear completed');

    // get all stations
    const stations = await Station.find().populate('sensors');
    await logToFile(`find ${stations.length} stations`);

    if (stations.length === 0) {
      await logToFile('⚠️ no stations data found, please ensure the database has station information');
      return;
    }

    // generate the start time 3 days ago
    const now = new Date();
    const startTime = new Date(now);
    startTime.setDate(now.getDate() - 3);
    startTime.setHours(0, 0, 0, 0);
    await logToFile(`generate data from ${startTime.toISOString()} to ${now.toISOString()}`);

    // calculate the total number of records
    const hours = Math.ceil((now - startTime) / (1000 * 60 * 60));
    const totalRecords = stations.length * hours;
    await logToFile(`expect to generate ${totalRecords} records (${stations.length} stations × ${hours} hours)`);

    // batch insertion count
    let insertedCount = 0;
    let batchSize = 1000;
    let batchDocuments = [];

    // generate data for each station
    for (const station of stations) {
      await logToFile(`generate data of ${station.name} (${station.id})`);

      // get all sensors of the station
      const sensors = station.sensors;
      
      if (!sensors || sensors.length === 0) {
        await logToFile(`⚠️ ${station.name} has no sensor data, skip`);
        continue;
      }

      // iterate over the time range (every hour)
      let currentTime = new Date(startTime);
      
      while (currentTime <= now) {
        // create a record for each sensor
        for (let sensor of sensors) {
          // ensure sensor is a complete object rather than an ID
          if (typeof sensor !== 'object' || !sensor.parameter) {
            try {
              sensor = await Sensor.findById(sensor);
              if (!sensor || !sensor.parameter) {
                continue; // skip invalid sensor
              }
            } catch (err) {
              await logToFile(`⚠️ error when getting sensor data: ${err.message}`);
              continue;
            }
          }

          const parameterName = sensor.parameter.name;
          if (!parameterName) continue;

          // create a measurement record
          const measurement = {
            station: station._id,
            parameter: {
              id: sensor.parameter.id,
              name: parameterName,
              units: sensor.parameter.units || 'µg/m³',
              displayName: sensor.parameter.displayName || parameterName.toUpperCase()
            },
            value: generateRandomValue(parameterName),
            timestamp: new Date(currentTime)
          };

          batchDocuments.push(measurement);
          
          // when the batch size is reached, insert the data
          if (batchDocuments.length >= batchSize) {
            try {
              await HourlyMeasurement.insertMany(batchDocuments);
              insertedCount += batchDocuments.length;
              await logToFile(`inserted ${insertedCount} records (${(insertedCount / totalRecords * 100).toFixed(2)}%)`);
              batchDocuments = [];
            } catch (err) {
              await logToFile(`⚠️ batch insertion failed: ${err.message}`);
              // may need to insert one by one to determine the problem
              for (const doc of batchDocuments) {
                try {
                  await new HourlyMeasurement(doc).save();
                  insertedCount++;
                } catch (saveErr) {
                  await logToFile(`⚠️ single insertion failed: ${saveErr.message}`);
                }
              }
              batchDocuments = [];
            }
          }
        }

        // increase one hour
        currentTime.setHours(currentTime.getHours() + 1);
      }
    }

    // insert the remaining batch documents
    if (batchDocuments.length > 0) {
      await HourlyMeasurement.insertMany(batchDocuments);
      insertedCount += batchDocuments.length;
      await logToFile(`inserted ${insertedCount} records (${(insertedCount / totalRecords * 100).toFixed(2)}%)`);
    } 

    // create indexes
    await logToFile('create indexes...');
    await HourlyMeasurement.collection.createIndex({ station: 1, timestamp: 1 });
    await HourlyMeasurement.collection.createIndex({ timestamp: 1 });
    await HourlyMeasurement.collection.createIndex({ 'parameter.name': 1 });
    await HourlyMeasurement.collection.createIndex({ 'station': 1, 'timestamp': 1, 'parameter.name': 1 });
    await logToFile('✅ indexes created');

    // summary
    const finalCount = await HourlyMeasurement.countDocuments();
    await logToFile(`✅ data generation completed. total inserted ${finalCount} records`);
    await logToFile(`expect ${totalRecords} records, actually inserted ${finalCount}`);

  } catch (error) {
    await logToFile(`❌ error: ${error.message}`);
    console.error(error);
  } finally {
    await mongoose.connection.close();
    await logToFile('database connection closed');
  }
}

// execute the main function
generateHistoricalData().then(() => {
  console.log('script executed successfully');
  process.exit(0);
}).catch(err => {
  console.error('script execution failed:', err);
  process.exit(1);
}); 