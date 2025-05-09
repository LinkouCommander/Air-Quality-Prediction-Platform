// services/dataCollectionService.js
import cron from 'node-cron';
import fetch from 'node-fetch';
import Station from '../models/Station.js';
import Sensor from '../models/Sensor.js';
import HourlyMeasurement from '../models/HourlyMeasurement.js';

const OPENAQ_API_KEY = process.env.OPENAQ_API_KEY;

// 向历史数据表中添加测试数据
export async function populateHistoricalData() {
  try {
    console.log('Start generating historical test data...');
    
    // find all stations
    const stations = await Station.find().populate('sensors');
    
    // get the current time
    const now = new Date();
    
    // generate data for the past 3 days
    for (let day = 0; day < 3; day++) {
      // 每天24小时
      for (let hour = 0; hour < 24; hour++) {
        const timestamp = new Date(now);
        timestamp.setDate(now.getDate() - day);
        timestamp.setHours(hour, 0, 0, 0);
        
        console.log(`Generating data for ${timestamp.toISOString()}`);
        
        // generate data for each station
        for (const station of stations) {
          // skip stations without sensors
          if (!station.sensors || station.sensors.length === 0) continue;
          
          // generate data for each sensor
          for (const sensor of station.sensors) {
            // check if the data already exists
            const existingData = await HourlyMeasurement.findOne({
              station: station._id,
              'parameter.name': sensor.parameter.name,
              timestamp
            });
            
            if (existingData) {
              console.log(`${station.name} - ${sensor.parameter.name} 在 ${timestamp.toISOString()} 已有数据，跳过`);
              continue;
            }
            
            // generate simulated value - random value plus time change factor
            let value = null;
            
            // base value
            let baseValue = 0;
            
            switch(sensor.parameter?.name) {
              case 'pm25':
                baseValue = 15 + Math.random() * 20; // 15-35
                break;
              case 'pm10':
                baseValue = 25 + Math.random() * 30; // 25-55
                break;
              case 'o3':
                baseValue = 20 + Math.random() * 40; // 20-60
                break;
              case 'no2':
                baseValue = 15 + Math.random() * 25; // 15-40
                break;
              case 'so2':
                baseValue = 5 + Math.random() * 10; // 5-15
                break;
              case 'co':
                baseValue = 0.5 + Math.random() * 2; // 0.5-2.5
                break;
              default:
                baseValue = 10 + Math.random() * 20; // 10-30
            }
            
            // add changes based on time
            // morning and evening pollution is slightly higher
            const hourFactor = hour < 6 ? 0.7 :  // 凌晨
                              hour < 9 ? 1.3 :   // 早高峰
                              hour < 17 ? 1.0 :  // 白天
                              hour < 20 ? 1.2 :  // 晚高峰
                              0.8;               // 夜间
            
            // generate the final value
            value = baseValue * hourFactor;
            
            // create a new hourly data record
            await HourlyMeasurement.create({
              station: station._id,
              parameter: {
                id: sensor.parameter.id,
                name: sensor.parameter.name,
                units: sensor.parameter.units,
                displayName: sensor.parameter.displayName
              },
              value: parseFloat(value.toFixed(2)),
              timestamp
            });
            
            // if it is the current hour, update the current value of the sensor
            if (day === 0 && hour === now.getHours()) {
              await Sensor.findByIdAndUpdate(sensor._id, {
                value: parseFloat(value.toFixed(2))
              });
            }
          }
        }
      }
    }
    
    console.log('Historical test data generation completed');
    return true;
  } catch (err) {
    console.error('Error generating historical data:', err);
    return false;
  }
}

// 每小时收集一次数据
export function startDataCollection() {
  // set to run at every hour
  cron.schedule('0 * * * *', async () => {
    console.log('Start collecting hourly air quality data...');
    try {
      const stations = await Station.find().populate('sensors');
      
      for (const station of stations) {
        // get the latest data for the station
        const response = await fetch(`https://api.openaq.org/v3/measurements?location_id=${station.id}&limit=100`, {
          headers: {
            'X-API-Key': OPENAQ_API_KEY,
            'Accept': 'application/json'
          }
        });
        
        if (!response.ok) {
          console.error(`Failed to get data for station ${station.id}`);
          continue;
        }
        
        const data = await response.json();
        const currentTime = new Date();
        // align to the hour
        currentTime.setMinutes(0, 0, 0);
        
        // process data for each sensor
        for (const sensor of station.sensors) {
          // find the latest measurement for the sensor
          const measurement = data.results?.find(m => 
            m.parameter?.id === sensor.parameter?.id || 
            m.parameter?.name === sensor.parameter?.name
          );
          
          let value = null;
          
          // if the real value is found, use it; otherwise generate a simulated value
          if (measurement && measurement.value !== undefined) {
            value = measurement.value;
          } else {
            // generate a reasonable simulated value for different parameters
            switch(sensor.parameter?.name) {
              case 'pm25':
                value = Math.random() * 40 + 5; // 5-45
                break;
              case 'pm10':
                value = Math.random() * 50 + 10; // 10-60
                break;
              case 'o3':
                value = Math.random() * 60 + 10; // 10-70
                break;
              case 'no2':
                value = Math.random() * 50 + 5; // 5-55
                break;
              case 'so2':
                value = Math.random() * 20 + 1; // 1-21
                break;
              case 'co':
                value = Math.random() * 5 + 0.2; // 0.2-5.2
                break;
              default:
                value = Math.random() * 30 + 5; // 5-35
            }
          }
          
          if (value !== null) {
            // check if the data already exists
            const existingRecord = await HourlyMeasurement.findOne({
              station: station._id,
              'parameter.name': sensor.parameter.name,
              timestamp: currentTime
            });
            
            if (!existingRecord) {
              // store the hourly data
              await HourlyMeasurement.create({
                station: station._id,
                parameter: {
                  id: sensor.parameter.id,
                  name: sensor.parameter.name,
                  units: sensor.parameter.units,
                  displayName: sensor.parameter.displayName
                },
                value: value,
                timestamp: currentTime
              });
            }
            
            // update the current value of the sensor
            await Sensor.findByIdAndUpdate(sensor._id, {
              value: value
            });
          }
        }
      }
      
      console.log('Hourly data collection completed');
    } catch (err) {
      console.error('Error collecting data:', err);
    }
  });
  
  console.log('Data collection service started');
}

// 初始运行一次数据收集
export async function collectDataOnce() {
  console.log('Manually run data collection once...');
  try {
    const stations = await Station.find().populate('sensors');
    
    for (const station of stations) {
      const currentTime = new Date();
      // align to the hour
      currentTime.setMinutes(0, 0, 0);
      
      // process data for each sensor
      for (const sensor of station.sensors) {
        // generate a simulated value
        let value = null;
        
        // generate a reasonable simulated value for different parameters
        switch(sensor.parameter?.name) {
          case 'pm25':
            value = Math.random() * 40 + 5; // 5-45
            break;
          case 'pm10':
            value = Math.random() * 50 + 10; // 10-60
            break;
          case 'o3':
            value = Math.random() * 60 + 10; // 10-70
            break;
          case 'no2':
            value = Math.random() * 50 + 5; // 5-55
            break;
          case 'so2':
            value = Math.random() * 20 + 1; // 1-21
            break;
          case 'co':
            value = Math.random() * 5 + 0.2; // 0.2-5.2
            break;
          default:
            value = Math.random() * 30 + 5; // 5-35
        }
        
        if (value !== null) {
          // check if the data already exists
          const existingRecord = await HourlyMeasurement.findOne({
            station: station._id,
            'parameter.name': sensor.parameter.name,
            timestamp: currentTime
          });
          
          if (!existingRecord) {
            // store the hourly data
            await HourlyMeasurement.create({
              station: station._id,
              parameter: {
                id: sensor.parameter.id,
                name: sensor.parameter.name,
                units: sensor.parameter.units,
                displayName: sensor.parameter.displayName
              },
              value: value,
              timestamp: currentTime
            });
          }
          
          // update the current value of the sensor
          await Sensor.findByIdAndUpdate(sensor._id, {
            value: value
          });
        }
      }
    }
    
    console.log('Manually data collection completed');
    return true;
  } catch (err) {
    console.error('Error collecting data:', err);
    return false;
  }
} 