const fetch = require('node-fetch');
require('dotenv').config();

// Get all sensors
async function getAllSensors(apiKey, limit = 10) {
  try {
    console.log(`Getting all sensors...`);
    const url = `https://api.openaq.org/v3/sensors?limit=${limit}&page=1&offset=0&sort=desc&order_by=id`;
    console.log(`Request URL: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'X-API-Key': apiKey,
        'Accept': 'application/json'
      },
      timeout: 10000
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log(`✅ Found ${data.results?.length || 0} sensors`);
      return data.results || [];
    } else {
      const text = await response.text();
      console.log(`❌ Failed to get sensors, status code: ${response.status}, response: ${text}`);
      return [];
    }
  } catch (error) {
    console.log(`❌ Failed to get sensors: ${error.message}`);
    return [];
  }
}

// test the measurements of a sensor
async function testSensorMeasurements(sensorId, apiKey) {
  try {
    console.log(`Testing sensor ID: ${sensorId} measurements`);
    const url = `https://api.openaq.org/v3/sensors/${sensorId}/measurements`;
    console.log(`Request URL: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'X-API-Key': apiKey,
        'Accept': 'application/json'
      },
      timeout: 8000
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log(`✅ sensor ID ${sensorId} is valid, returned ${data.results?.length || 0} measurements`);
      if (data.results && data.results.length > 0) {
        console.log(`First data: ${JSON.stringify(data.results[0])}`);
      }
      return true;
    } else {
      const text = await response.text();
      console.log(`❌ sensor ID ${sensorId} is invalid, status code: ${response.status}, response: ${text}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Testing sensor ID ${sensorId} failed: ${error.message}`);
    return false;
  }
}

// 主函数
async function main() {
  // Get the API key from the environment variable
  const apiKey = process.env.OPENAQ_API_KEY;
  
  if (!apiKey) {
    console.log('Error: Missing OpenAQ API key');
    return;
  }
  
  // test the API key validity
  console.log(`Using API key: ${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`);
  
  // Get all sensors
  const sensors = await getAllSensors(apiKey);
  
  if (sensors.length === 0) {
    console.log('Failed to get any sensors');
    return;
  }
  
  // print the sensors example
  console.log('sensors example:');
  sensors.slice(0, 5).forEach(sensor => {
    console.log(`ID: ${sensor.id}, parameter: ${sensor.parameter?.name || 'unknown'}, location: ${sensor.location?.name || 'unknown'}`);
  });
  
  // test the measurements of the first sensor
  console.log('\nTesting the measurements of the first sensor:');
  await testSensorMeasurements(sensors[0].id, apiKey);
  
  console.log('\n=== Lambda function repair plan ===');
  console.log('1. Modify the Lambda function, use the new API endpoint');
  console.log('2. Do not directly use location_id to get measurements, but first get sensor_id');
  console.log('3. Use sensor_id to get measurements');
  console.log('4. Example code:');
  console.log(`
// Get the sensors associated with the station
async function getSensorsForLocation(locationId, apiKey) {
  try {
    const url = \`https://api.openaq.org/v3/sensors?location_id=\${locationId}\`;
    const response = await fetch(url, {
      headers: {
        'X-API-Key': apiKey,
        'Accept': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      return data.results || [];
    } else {
      throw new Error(\`获取传感器失败: \${response.status}\`);
    }
  } catch (error) {
    console.error(\`获取传感器错误: \${error.message}\`);
    return [];
  }
}

// Get the measurements of a sensor
async function getMeasurementsForSensor(sensorId, apiKey) {
  try {
    const url = \`https://api.openaq.org/v3/sensors/\${sensorId}/measurements\`;
    const response = await fetch(url, {
      headers: {
        'X-API-Key': apiKey,
        'Accept': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      return data.results || [];
    } else {
      throw new Error(\`获取测量数据失败: \${response.status}\`);
    }
  } catch (error) {
    console.error(\`Failed to get measurements: \${error.message}\`);
    return [];
  }
}`);
  
  console.log('\n测试完成');
}

// execute the test
main().catch(console.error); 