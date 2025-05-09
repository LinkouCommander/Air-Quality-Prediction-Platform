import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';

// load the environment variables
dotenv.config();

// MongoDB connection URI
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('Error: The environment variable MONGO_URI is not set');
  process.exit(1);
}

console.log('Using MongoDB connection:', MONGO_URI.substring(0, 25) + '...');

// define the models
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

// create the indexes
HourlyMeasurementSchema.index({ station: 1, timestamp: 1 });
HourlyMeasurementSchema.index({ timestamp: 1 });
HourlyMeasurementSchema.index({ 'parameter.name': 1 });
HourlyMeasurementSchema.index({ 'station': 1, 'timestamp': 1, 'parameter.name': 1 });

// 创建模型
const Station = mongoose.model('Station', StationSchema);
const Sensor = mongoose.model('Sensor', SensorSchema);
const HourlyMeasurement = mongoose.model('HourlyMeasurement', HourlyMeasurementSchema);

// 生成随机空气质量数据的函数（根据参数类型返回合理范围内的值）
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

// 日志函数
async function logToFile(message) {
  const logFile = 'data_generation.log';
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${message}\n`;
  
  console.log(message);
  
  try {
    await fs.appendFile(logFile, logMessage);
  } catch (err) {
    console.error('Failed to write to the log file:', err);
  }
}

// main function
async function generateHistoricalData() {
  try {
    await logToFile('Starting to connect to MongoDB...');
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    await logToFile('✅ MongoDB connection successful');

    // 清空现有数据
    await logToFile('Clearing the existing hourly measurement data...');
    await HourlyMeasurement.deleteMany({});
    await logToFile('✅ Clearing completed');

    // 获取所有监测站
    const stations = await Station.find().populate('sensors');
    await logToFile(`Got ${stations.length} stations`);

    if (stations.length === 0) {
      await logToFile('⚠️ No station data found, please ensure that the database has station information');
      return;
    }

    //  generate the data from 3 days ago to now
    const now = new Date();
    const startTime = new Date(now);
    startTime.setDate(now.getDate() - 3);
    startTime.setHours(0, 0, 0, 0);
    await logToFile(`Generating data from ${startTime.toISOString()} to ${now.toISOString()}`);

    // calculate the total number of records
    const hours = Math.ceil((now - startTime) / (1000 * 60 * 60));
    const totalRecords = stations.length * hours;
    await logToFile(`Expected to generate ${totalRecords} records (${stations.length} stations × ${hours} hours)`);

    // batch insertion count
    let insertedCount = 0;
    let batchSize = 1000;
    let batchDocuments = [];

    // generate data for each station
    for (const station of stations) {
      await logToFile(`Generating data for station ${station.name} (${station.id})`);

      // get the sensors of the station
      const sensors = station.sensors;
      
      if (!sensors || sensors.length === 0) {
        await logToFile(`⚠️ Station ${station.name} has no sensor data, skipping`);
        continue;
      }

      // iterate over the time range (hourly)
      let currentTime = new Date(startTime);
      
      while (currentTime <= now) {
        // create a record for each sensor
        for (let sensor of sensors) {
          // ensure that the sensor is a complete object and not just an ID
          if (typeof sensor !== 'object' || !sensor.parameter) {
            try {
              sensor = await Sensor.findById(sensor);
              if (!sensor || !sensor.parameter) {
                continue; // skip invalid sensors
              }
            } catch (err) {
              await logToFile(`⚠️ Failed to get sensor data: ${err.message}`);
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
              await logToFile(`Already inserted ${insertedCount} records   (${(insertedCount / totalRecords * 100).toFixed(2)}%)`);
              batchDocuments = [];
            } catch (err) {
              await logToFile(`⚠️ Batch insertion failed: ${err.message}`);
              // it may be necessary to insert one by one to determine the problem
              for (const doc of batchDocuments) {
                try {
                  await new HourlyMeasurement(doc).save();
                  insertedCount++;
                } catch (saveErr) {
                  await logToFile(`⚠️ Single insertion failed: ${saveErr.message}`);
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
      await logToFile(`Already inserted ${insertedCount} records   (${(insertedCount / totalRecords * 100).toFixed(2)}%)`);
    }

    // create the indexes
    await logToFile('Creating the indexes...');
    await HourlyMeasurement.collection.createIndex({ station: 1, timestamp: 1 });
    await HourlyMeasurement.collection.createIndex({ timestamp: 1 });
    await HourlyMeasurement.collection.createIndex({ 'parameter.name': 1 });
    await HourlyMeasurement.collection.createIndex({ 'station': 1, 'timestamp': 1, 'parameter.name': 1 });
    await logToFile('✅ Indexes created');

    // summary
    const finalCount = await HourlyMeasurement.countDocuments();
    await logToFile(`✅ Data generation completed. Total inserted ${finalCount} records.`);
    await logToFile(`Expected records: ${totalRecords}, actual inserted: ${finalCount}`);

  } catch (error) {
    await logToFile(`❌ 错误: ${error.message}`);
    console.error(error);
  } finally {
    await mongoose.connection.close();
    await logToFile('Database connection closed');
  }
}

// execute the main function
generateHistoricalData().then(() => {
  console.log('Script execution completed');
  process.exit(0);
}).catch(err => {
  console.error('Script execution failed:', err);
  process.exit(1);
}); 