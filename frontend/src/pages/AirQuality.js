import React, { useState, useEffect } from 'react';
import axios from 'axios';

const TEST_LOCATIONS = [
  { name: "Beijing", latitude: 39.9042, longitude: 116.4074 },
  { name: "Shanghai", latitude: 31.2304, longitude: 121.4737 },
  { name: "Guangzhou", latitude: 23.1291, longitude: 113.2644 },
  { name: "Nima", latitude: 5.58389, longitude: -0.19968 }
];

const AirQuality = () => {
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [airQuality, setAirQuality] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [debug, setDebug] = useState('');

  const handleLocationSelect = (location) => {
    setLatitude(location.latitude.toString());
    setLongitude(location.longitude.toString());
  };

  const fetchLocationData = async (lat, lon) => {
    try {
      const apiKey = process.env.REACT_APP_OPENAQ_API_KEY;
      console.log('Attempting API call with coordinates:', lat, lon);
      
      const response = await axios.get(
        '/v3/locations',
        {
          params: {
            coordinates: `${lat},${lon}`,
            radius: 10000,
            limit: 1,
            order_by: ['distance']
          },
          headers: {
            'X-API-Key': apiKey,
            'Accept': 'application/json'
          }
        }
      );

      console.log('API Response:', response.data);

      if (response.data.results && response.data.results.length > 0) {
        const location = response.data.results[0];
        const measurements = location.sensors || [];
        const pm25Data = measurements.find(s => s.parameter?.name === 'pm25');
        
        if (!pm25Data) {
          throw new Error('The monitoring station does not have PM2.5 data');
        }

        setAirQuality({
          name: location.name,
          pm25: pm25Data.value,
          coordinates: location.coordinates,
          lastUpdated: location.datetimeLast?.local || '未知'
        });
        setDebug(`Successfully retrieved data from the monitoring station ${location.name}`);
      } else {
        throw new Error('No monitoring station found in the specified location');
      }
    } catch (err) {
      console.error('Error details:', err.response || err);
      throw err;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setAirQuality(null);
    
    try {
      await fetchLocationData(parseFloat(latitude), parseFloat(longitude));
    } catch (err) {
      console.error('Error details:', err);
      if (err.code === 'ECONNABORTED') {
        setError('Request timeout, please check your network connection');
      } else if (err.response) {
        if (err.response.status === 401) {
          setError('Invalid API key, please check the REACT_APP_OPENAQ_API_KEY in the .env file');
        } else if (err.response.status === 403) {
          setError('API request denied, please check if the API key is correct');
        } else if (err.response.status === 429) {
          setError('API request limit exceeded, please try again later');
        } else {
          setError(`API error: ${err.response.status} - ${err.response.data?.message || '未知错误'}`);
        }
      } else if (err.message) {
        setError(err.message);
      } else {
        setError('Error getting data, please check your network connection');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Air Quality Query</h1>
      
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-2">测试位置</h2>
        <div className="grid grid-cols-2 gap-2">
          {TEST_LOCATIONS.map((location) => (
            <button
              key={location.name}
              onClick={() => handleLocationSelect(location)}
              className="p-2 text-sm bg-gray-100 hover:bg-gray-200 rounded"
            >
              {location.name}
            </button>
          ))}
        </div>
      </div>
      
      {debug && (
        <div className="mb-4 p-2 bg-gray-100 text-gray-600 text-sm rounded">
          {debug}
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">纬度</label>
          <input
            type="number"
            step="any"
            value={latitude}
            onChange={(e) => setLatitude(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            placeholder="例如: 5.58389"
            required
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700">经度</label>
          <input
            type="number"
            step="any"
            value={longitude}
            onChange={(e) => setLongitude(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            placeholder="例如: -0.19968"
            required
          />
        </div>
        
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {loading ? 'Querying...' : 'Query Air Quality'}
        </button>
      </form>

      {error && (
        <div className="mt-4 p-4 bg-red-100 text-red-700 rounded-md">
          {error}
        </div>
      )}

      {airQuality && (
        <div className="mt-6 p-4 bg-white rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-2">{airQuality.name}</h2>
          <div className="space-y-2">
            <p>PM2.5: {airQuality.pm25} µg/m³</p>
            <p>Latitude: {airQuality.coordinates.latitude}</p>
            <p>Longitude: {airQuality.coordinates.longitude}</p>
            <p className="text-sm text-gray-500">
              Last updated: {new Date(airQuality.lastUpdated).toLocaleString()}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default AirQuality; 