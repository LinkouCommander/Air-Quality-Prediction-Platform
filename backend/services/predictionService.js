import EM from 'expectation-maximization';
import Station from '../models/Station.js';
import HourlyMeasurement from '../models/HourlyMeasurement.js';
import Sensor from '../models/Sensor.js';

// calculate the distance between two points (km)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; //  the radius of the earth (km)
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// predict the air quality at a specific location at a specific time
export async function predictAirQuality(latitude, longitude, timestamp, parameterName = 'pm25', radius = 5) {
  try {
    // parameter validation
    if (latitude === undefined || longitude === undefined) {
      throw new Error('Missing required parameters: latitude, longitude');
    }
    
    // ensure the parameter type is correct
    latitude = parseFloat(latitude);
    longitude = parseFloat(longitude);
    radius = parseFloat(radius);
    
    // validate the value
    if (isNaN(latitude) || isNaN(longitude) || isNaN(radius)) {
      throw new Error('Invalid coordinate or radius value');
    }
    
    // check if the timestamp is valid
    let validTimestamp;
    try {
      validTimestamp = timestamp ? new Date(timestamp) : new Date();
      // check if the date object is valid
      if (isNaN(validTimestamp.getTime())) {
        throw new Error('Invalid timestamp');
      }
    } catch (err) {
      throw new Error(`Invalid timestamp format: ${err.message}`);
    }
    
    // ensure the parameter name is a string
    if (parameterName && typeof parameterName !== 'string') {
      parameterName = String(parameterName);
    }
    
    console.log(`Start predicting the ${parameterName} value in the area within ${radius} km of (${latitude}, ${longitude})`);
    console.log(`Using timestamp: ${validTimestamp.toISOString()}`);
    
    // convert the timestamp to the nearest hour
    const requestedTime = validTimestamp;
    // round down to the nearest hour (e.g. 2:53 becomes 2:00)
    const hourTime = new Date(requestedTime);
    hourTime.setMinutes(0);
    hourTime.setSeconds(0);
    hourTime.setMilliseconds(0);
    
    console.log(`Original query time: ${requestedTime.toISOString()}`);
    console.log(`Rounded down to the nearest hour: ${hourTime.toISOString()}`);
    
    // find all stations
    const stations = await Station.find().populate('sensors');
    console.log(`There are ${stations.length} stations in the database`);
    
    // calculate the distance between each station and the target point, and filter out the stations within the user-specified radius
    const nearbyStations = stations.filter(station => {
      if (!station.coordinates || !station.coordinates.latitude || !station.coordinates.longitude) {
        return false;
      }
      
      const distance = calculateDistance(
        latitude, longitude,
        station.coordinates.latitude, station.coordinates.longitude
      );
      
      // save the distance for later use
      station.distance = distance;
      
      return distance <= radius; // stations within the user-specified radius
    });
    
    console.log(`Found ${nearbyStations.length} stations within ${radius} km`);
    
    // if there are no stations, expand the search range and try again
    if (nearbyStations.length === 0) {
      console.log(`found no stations within ${radius} km, expanding to ${radius} km and trying again`);
      return {
        success: false,
        error: `No monitoring stations available within ${radius} km of this area, unable to provide prediction`
      };
    }
    
    // 检查1公里内是否有站点
    const veryCloseStation = nearbyStations.find(s => s.distance <= 1);
    
    // 将要使用的站点集合，默认是所有nearbyStations
    let stationsToUse = nearbyStations;
    
    if (veryCloseStation) {
      console.log(`Found a station within 1 km: ${veryCloseStation.name}, distance ${veryCloseStation.distance.toFixed(2)} km`);
      
      // 查找该站点对应参数的传感器
      const sensor = veryCloseStation.sensors.find(s => 
        s.parameter?.name?.toLowerCase() === parameterName.toLowerCase()
      );
      
      if (sensor) {
        console.log(`Found a sensor: parameter=${sensor.parameter?.name}, unit=${sensor.parameter?.units}`);
        
        // 首先尝试从HourlyMeasurement获取数据
        const measurement = await HourlyMeasurement.findOneByTime({
          station: veryCloseStation._id,
          'parameter.name': sensor.parameter.name,
          timestamp: hourTime  // 使用精确的整点时间
        });
        
        if (measurement) {
          console.log(`Found an hourly data record: ${measurement.value} ${measurement.parameter.units}, time: ${measurement.timestamp}`);
          return {
            success: true,
            method: 'direct',
            value: measurement.value,
            station: veryCloseStation.name,
            distance: veryCloseStation.distance.toFixed(2),
            unit: measurement.parameter.units,
            timestamp: measurement.timestamp
          };
        } else {
          console.log(`No hourly data record found, trying to use the current value of the sensor`);
          
          // if no hourly data record is found, try to use the current value of the sensor
          if (sensor.value !== undefined) {
            return {
              success: true,
              method: 'sensor',
              value: sensor.value,
              station: veryCloseStation.name,
              distance: veryCloseStation.distance.toFixed(2),
              unit: sensor.parameter.units || 'µg/m³',
              timestamp: new Date() // current time
            };
          }
        }
      } else {
        console.log(`The station does not have a sensor for the ${parameterName} parameter`);
      }
    } else {
      // 1公里内没有监测站，检查5公里范围内的站点
      console.log(`No station within 1 km, checking the stations within 5 km`);
      
      // 确保nearbyStations是有效数组
      if (!nearbyStations || !Array.isArray(nearbyStations)) {
        console.error('nearbyStations is not a valid array', nearbyStations);
        return {
          success: false,
          error: 'Invalid station data, cannot predict'
        };
      }
      
      // safely filter the stations within 5 km
      const stationsWithin5km = Array.isArray(nearbyStations) ? 
        nearbyStations.filter(s => s && typeof s === 'object' && !isNaN(s.distance) && s.distance <= 5) : 
        [];
        
      console.log(`After filtering, found ${stationsWithin5km.length} stations within 5 km`);
      
      if (stationsWithin5km.length === 0) {
        // 5公里内也没有站点，给出明确错误
        console.log(`No stations within 5 km, cannot predict`);
        return {
          success: false,
          error: '5km range has no available stations, cannot predict'
        };
      }
      
      console.log(`Found ${stationsWithin5km.length} stations within 5 km, using these stations for calculation`);
      
      // continue, but only use the stations within 5 km
      stationsToUse = stationsWithin5km;
    }
    // do not return an error here, but continue using the distance weighted average method
    
    // ensure stationsToUse is a valid array
    if (!stationsToUse || !Array.isArray(stationsToUse)) {
      console.error('stationsToUse is not a valid array', stationsToUse);
      return {
        success: false,
        error: 'Error processing station data, cannot predict'
      };
    }
    
    // try to collect data from all available stations for prediction
    console.log(`Trying to collect data from all stations for prediction, there are ${stationsToUse.length} stations`);
    const stationData = [];
    
    // get data from each station
    for (const station of stationsToUse) {
      // ensure station is a valid object
      if (!station || typeof station !== 'object') {
        console.log('Skipping invalid station');
        continue;
      }
      
      // 确保station.sensors是有效数组
      if (!station.sensors || !Array.isArray(station.sensors)) {
        console.log(`The station ${station.name || 'unknown'} does not have a valid sensor array`);
        continue;
      }
      
      // find the sensor corresponding to the parameter
      const sensor = station.sensors.find(s => 
        s && s.parameter && s.parameter.name && 
        s.parameter.name.toLowerCase() === parameterName.toLowerCase()
      );
      
      if (!sensor) {
        console.log(`The station ${station.name || 'unknown'} does not have a sensor for the ${parameterName} parameter`);
        continue;
      }
      
      console.log(`The station ${station.name || 'unknown'} has a ${parameterName} sensor, checking data...`);
      
      try {
        // 确保站点有有效ID
        if (!station._id) {
          console.log(`The station does not have a valid ID, skipping`);
          continue;
        }
        
        // find the data of the station at the specified time
        const measurement = await HourlyMeasurement.findOneByTime({
          station: station._id,
          'parameter.name': sensor.parameter?.name,
          timestamp: hourTime  // use the exact hour time
        }); 

        if (measurement) {
          console.log(`Found the data of the station ${station.name || 'unknown'}: ${measurement.value}, time: ${measurement.timestamp}`);
          
          // ensure all fields have values
          if (measurement.value !== undefined && measurement.value !== null && !isNaN(parseFloat(measurement.value))) {
            stationData.push({
              station: station.name || 'unknown station',
              distance: parseFloat(station.distance),
              value: parseFloat(measurement.value),
              unit: measurement.parameter?.units || 'µg/m³',
              coordinates: [
                station.coordinates?.latitude || 0,
                station.coordinates?.longitude || 0
              ],
              timestamp: measurement.timestamp
            });
          } else {
            console.log(`The data value of the station ${station.name || 'unknown'} is invalid: ${measurement.value}`);
          }
        } else if (sensor.value !== undefined && sensor.value !== null && !isNaN(parseFloat(sensor.value))) {
          // 如果没有历史数据，使用传感器当前值
          console.log(`Using the current value of the sensor of the station ${station.name || 'unknown'}: ${sensor.value}`);
          stationData.push({
            station: station.name || 'unknown station',
            distance: parseFloat(station.distance),
            value: parseFloat(sensor.value),
            unit: sensor.parameter?.units || 'µg/m³',
            coordinates: [
              station.coordinates?.latitude || 0,
              station.coordinates?.longitude || 0
            ],
            timestamp: new Date()
          });
        } else {
          console.log(`The station ${station.name || 'unknown'} does not have available ${parameterName} data`);
        }
      } catch (err) {
        console.error(`Error processing the station ${station.name || 'unknown'}:`, err);
        
        // handle specific MongoDB errors
        if (err.message && (
          err.message.includes('Invalid sort value') || 
          err.message.includes('$expr')
        )) {
          console.error('Detected MongoDB sorting expression error, which may be due to MongoDB version incompatibility');
          return {
            success: false,
            error: 'The system encountered a database compatibility issue, please contact the administrator or try using another location for the query',
            queryTime: hourTime.toISOString() // add query time information for debugging
          };
        }

        // continue processing other stations, do not interrupt the loop
      }
    }
    
    console.log(`Collected ${stationData.length} valid data from stations`);
    
    // if no data is collected, return an error
    if (stationData.length === 0) {
      return {
        success: false,
        error: 'No available air quality data found'
      };
    }
    
    // if there is only 1 data point, directly return the value of the point
    if (stationData.length === 1) {
      console.log(`Only 1 data point, directly use the value of the point`);
      return {
        success: true,
        method: 'single',
        value: stationData[0].value,
        station: stationData[0].station,
        distance: stationData[0].distance.toFixed(2),
        unit: stationData[0].unit,
        stationCount: 1
      };
    }
    
    // select the most suitable method based on the number of data points
    let predictionMethod = '';
    let predictionValue = 0;
    let methodNote = '';

    try {
      // 1. 基本的IDW (Inverse Distance Weighting) 算法 - 适用于任何数量的数据点
      const idwValue = calculateIDW(stationData);
      console.log(`IDW prediction value: ${idwValue.toFixed(2)}`);
      
      // 2. 加强版IDW，使用更高的幂次（距离平方反比）
      const idwPower2Value = calculateIDWWithPower(stationData, 2);
      console.log(`IDW(p=2) prediction value: ${idwPower2Value.toFixed(2)}`);
      
      // 3. 简单算术平均 - 不考虑距离，适用于数据点较少且分布均匀的情况
      const simpleAvgValue = calculateSimpleAverage(stationData);
      console.log(`Simple average value: ${simpleAvgValue.toFixed(2)}`);
      
      // select the most suitable prediction method based on the current situation
      if (stationData.length <= 2) {
        // when there are 2 or fewer data points, use the basic IDW
        predictionValue = idwValue;
        predictionMethod = 'idw_basic';
        methodNote = 'Based on Inverse Distance Weighting (IDW)';
      } else if (stationData.length <= 4) {
        // when there are 3-4 data points, use the enhanced IDW
        predictionValue = idwPower2Value;
        predictionMethod = 'idw_enhanced';
        methodNote = 'Based on Enhanced Inverse Distance Weighting (IDW²)';
      } else {
        // when there are 5 or more data points, decide which method to use based on the station distribution
        
        // calculate the average distance of the stations to the target point
        const avgDistance = stationData.reduce((sum, s) => sum + s.distance, 0) / stationData.length;
        
        // calculate the standard deviation of the distances, to judge if the station distribution is uniform
        const distanceVariance = stationData.reduce((sum, s) => sum + Math.pow(s.distance - avgDistance, 2), 0) / stationData.length;
        const distanceStdDev = Math.sqrt(distanceVariance);
        
        // if the station distribution is relatively uniform (small standard deviation), use the simple average
        if (distanceStdDev < avgDistance * 0.3) {
          predictionValue = simpleAvgValue;
          predictionMethod = 'simple_avg';
          methodNote = 'Based on the simple average of the surrounding stations';
        } else {
          // otherwise, use the enhanced IDW
          predictionValue = idwPower2Value;
          predictionMethod = 'idw_enhanced';
          methodNote = 'Based on Enhanced Inverse Distance Weighting (IDW²)';
        }
      }
      
      return {
        success: true,
        method: predictionMethod,
        value: parseFloat(predictionValue.toFixed(2)),
        stations: stationData.map(s => s.station).join(', '),
        unit: stationData[0]?.unit || 'µg/m³',
        stationCount: stationData.length,
        note: `${methodNote}, using data from ${stationData.length} stations`
      };
    } catch (innerErr) {
      console.error('Error in the prediction calculation process:', innerErr);
      return {
        success: false,
        error: `Error in the prediction calculation process: ${innerErr.message}`,
        stationCount: stationData.length
      };
    }
  } catch (err) {
    console.error('Error in the prediction process:', err);
    
    // 处理特定的MongoDB错误
    if (err.message && (
        err.message.includes('Invalid sort value') || 
        err.message.includes('$expr') || 
        err.message.includes('Cannot read properties of undefined')
    )) {
      console.error('Detected MongoDB query error, which may be due to MongoDB version incompatibility or database configuration issues');
      return {
        success: false,
        error: 'The system encountered a database compatibility issue, please try using another location or reduce the search radius for the query',
        coordinates: [latitude, longitude],
        searchRadius: radius
      };
    }
    
    return {
      success: false,
      error: 'Error in the prediction process: ' + err.message
    };
  }
}

// auxiliary function: calculate IDW
function calculateIDW(dataPoints, power = 1) {
  if (!dataPoints || !Array.isArray(dataPoints) || dataPoints.length === 0) {
    throw new Error('No valid data points for IDW calculation');
  }
  
  //  check each data point
  dataPoints.forEach((point, index) => {
    if (!point || typeof point !== 'object') {
      throw new Error(`Data point #${index} is invalid, missing necessary properties`);
    }
    if (point.value === undefined || point.value === null || isNaN(parseFloat(point.value))) {
      throw new Error(`Data point #${index} is invalid, invalid value`);
    }
    if (point.distance === undefined || point.distance === null || isNaN(parseFloat(point.distance))) {
      throw new Error(`Data point #${index} is invalid, invalid distance`);
    }
  });
  
  //  ensure the value type
  const points = dataPoints.map(p => ({
    ...p,
    distance: parseFloat(p.distance),
    value: parseFloat(p.value)
  }));
  
  const weights = points.map(p => 1 / Math.pow((p.distance + 0.1), power));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  
  if (totalWeight === 0) {
    throw new Error('Total weight is zero in the IDW calculation');
  }
  
  const weightedSum = points.reduce((sum, p, i) => sum + p.value * weights[i], 0);
  return weightedSum / totalWeight;
}

// auxiliary function: calculate IDW with a specified power
function calculateIDWWithPower(dataPoints, power) {
  if (!dataPoints || !Array.isArray(dataPoints) || dataPoints.length === 0) {
    throw new Error('No valid data points for IDW(power) calculation');
  }
  return calculateIDW(dataPoints, power);
}

// auxiliary function: calculate the simple average
function calculateSimpleAverage(dataPoints) {
  if (!dataPoints || !Array.isArray(dataPoints) || dataPoints.length === 0) {
    throw new Error('No valid data points for average calculation');
  }
  
  //  check each data point has a valid value
  dataPoints.forEach((point, index) => {
    if (!point || typeof point !== 'object') {
      throw new Error(`Data point #${index} is invalid, missing necessary properties`);
    }
    if (point.value === undefined || point.value === null || isNaN(parseFloat(point.value))) {
      throw new Error(`Data point #${index} is invalid, invalid value`);
    }
  });
  
  // ensure the value type
  const values = dataPoints.map(p => parseFloat(p.value));
  const sum = values.reduce((sum, val) => sum + val, 0);
  return sum / values.length;
} 