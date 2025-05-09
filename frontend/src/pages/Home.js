import React, { useState, useEffect } from 'react';
import Map, { Marker, Popup, NavigationControl, FullscreenControl, Source, Layer } from 'react-map-gl';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import 'mapbox-gl/dist/mapbox-gl.css';
import './Home.css';

// using environment variable
const MAPBOX_TOKEN = process.env.REACT_APP_MAPBOX_TOKEN;

const Home = () => {
  const [viewport, setViewport] = useState({ //set LA coordinates
    latitude: 34.0522,
    longitude: -118.2437,
    zoom: 10
  });
  const [stations, setStations] = useState([]);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [historicalData, setHistoricalData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mapLoaded, setMapLoaded] = useState(false); // add map loaded status
  const [showPrediction, setShowPrediction] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState(null);
  
  // fix initial time setting, using local time instead of UTC time
  const getCurrentTimeISOString = () => {
    const now = new Date();
    now.setSeconds(0, 0); // ignore seconds and milliseconds
    
    // using local date time format, avoid timezone problem
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };
  
  const [predictionTime, setPredictionTime] = useState(getCurrentTimeISOString());
  
  // add: area selection status
  const [isSelectingArea, setIsSelectingArea] = useState(false);
  const [firstPoint, setFirstPoint] = useState(null);
  const [secondPoint, setSecondPoint] = useState(null);
  const [areaData, setAreaData] = useState(null);
  const [isLoadingArea, setIsLoadingArea] = useState(false);
  const [showAreaStats, setShowAreaStats] = useState(false);

  // area radius fixed to 5 km
  const [areaRadius] = useState(5);

  // add: control station display status
  const [showAllStations, setShowAllStations] = useState(true);
  const [stationInfo, setStationInfo] = useState({});

  // calculate the time range limit, fix the timezone problem
  const getTimeConstraints = () => {
    const now = new Date();
    now.setSeconds(0, 0);
    
    // set the minimum date to April 30, 2025, instead of 3 days ago
    const minDate = new Date(2025, 3, 30); // note that the month is 0-based, so April is 3
    
    // using local date time format, avoid timezone problem
    const formatDate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    };
    
    return {
      max: formatDate(now), // current time
      min: formatDate(minDate) // April 30, 2025
    };
  };
  
  const timeConstraints = getTimeConstraints();

  // Get air quality monitoring station data
  useEffect(() => {
    const fetchStations = async () => {
      try {
        setLoading(true);
        setError(null);

        if (!process.env.REACT_APP_OPENAQ_API_KEY) {
          throw new Error('OpenAQ API key not set');
        }

        if (!MAPBOX_TOKEN) {
          throw new Error('Mapbox access token not set');
        }

        const response = await fetch(`${process.env.REACT_APP_API_URL}/api/stations`);

        if (!response.ok) {
          throw new Error(
            `API request failed: ${response.status} - ${response.statusText}`
          );
        }

        const data = await response.json();

        if (!data || !Array.isArray(data)) {
          throw new Error('Wrong API format');
        }

        // process the station data, add extra information
        const processedStations = data.map(station => {
          // extract PM2.5 data as the main display data
          const pm25Sensor = station.sensors?.find(s => s.parameter?.name === 'pm25');
          const pm25Value = pm25Sensor?.value !== undefined ? pm25Sensor.value : null;
          const qualityLevel = pm25Value !== null ? getAirQualityLevel(pm25Value, 'pm25') : 'unknown';
          
          return {
            ...station,
            pm25Value,
            qualityLevel
          };
        });

        setStations(processedStations);
        console.log(`Loaded ${processedStations.length} monitoring stations`);
      } catch (error) {
        console.error('Error occurred while fetching station data:', error);
        setError(error.message || 'Unable to fetch station data, please try again later');
      } finally {
        setLoading(false);
      }
    };

    fetchStations();
  }, []);

  const predictAirQuality = (lat, lng, stations) => {
    const prediction = {
      value: 'N/A',
      source: 'Nearest station',
      stationName: null,
      distance: null,
      parameters: {}
    };

    if (stations.length === 0) {
      return prediction;
    }

    let closestStation = null;
    let minDistance = Infinity;

    // iterate through all stations, find the nearest oneh all stations, find the nearest one
    stations.forEach(station => {
      if (station.coordinates && station.coordinates.latitude && station.coordinates.longitude) {
        const distance = getDistance(
          lat, lng,
          station.coordinates.latitude,
          station.coordinates.longitude
        );
        if (distance < minDistance) {
          minDistance = distance;
          closestStation = station;
        }
      }
    });

    if (closestStation) {
      const pm25Sensor = closestStation.sensors?.find(s => s.parameter?.name === 'pm25');
      const pm25Value = pm25Sensor?.value;

      prediction.value = pm25Value !== undefined ? pm25Value : 'N/A';
      prediction.stationName = closestStation.name;
      prediction.distance = minDistance.toFixed(2);

      // fill all parameters
      const parameterNames = ['pm25', 'pm10', 'o3', 'no2', 'so2', 'co'];
      parameterNames.forEach(paramName => {
        const sensor = closestStation.sensors?.find(s => s.parameter?.name === paramName);
        if (sensor && sensor.value !== undefined) {
          prediction.parameters[paramName] = sensor.value;
        }
      });
    } else {
      prediction.source = 'No valid station';
    }

    return prediction;
  };

  // calculate the distance between two points (km)
  const getDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // earth radius (km)
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const deg2rad = (deg) => {
    return deg * (Math.PI / 180);
  };

  // Get air quality level function
  const getAirQualityLevel = (value, parameter) => {
    if (value === undefined || value === null) return 'unknown';

    // Based on different parameter thresholds
    const thresholds = {
      pm25: [
        { max: 50, level: 'good' },           // good
        { max: 100, level: 'moderate' },       // moderate
        { max: 150, level: 'unhealthy-sensitive' }, // unhealthy-sensitive
        { max: 200, level: 'unhealthy' },      // unhealthy
        { max: 300, level: 'very-unhealthy' }, // very-unhealthy
        { max: Infinity, level: 'hazardous' }  // hazardous
      ],
      pm10: [
        { max: 50, level: 'good' },           // good
        { max: 100, level: 'moderate' },       // moderate
        { max: 150, level: 'unhealthy-sensitive' }, // unhealthy-sensitive
        { max: 200, level: 'unhealthy' },      // unhealthy
        { max: 300, level: 'very-unhealthy' }, // very-unhealthy
        { max: Infinity, level: 'hazardous' }  // hazardous
      ],
      o3: [
        { max: 54, level: 'good' },
        { max: 124, level: 'moderate' },
        { max: 164, level: 'unhealthy-sensitive' },
        { max: 204, level: 'unhealthy' },
        { max: 404, level: 'very-unhealthy' },
        { max: Infinity, level: 'hazardous' }
      ],
      no2: [
        { max: 53, level: 'good' },
        { max: 100, level: 'moderate' },
        { max: 360, level: 'unhealthy-sensitive' },
        { max: 649, level: 'unhealthy' },
        { max: 1249, level: 'very-unhealthy' },
        { max: Infinity, level: 'hazardous' }
      ],
      so2: [
        { max: 35, level: 'good' },
        { max: 75, level: 'moderate' },
        { max: 185, level: 'unhealthy-sensitive' },
        { max: 304, level: 'unhealthy' },
        { max: 604, level: 'very-unhealthy' },
        { max: Infinity, level: 'hazardous' }
      ],
      co: [
        { max: 4.4, level: 'good' },
        { max: 9.4, level: 'moderate' },
        { max: 12.4, level: 'unhealthy-sensitive' },
        { max: 15.4, level: 'unhealthy' },
        { max: 30.4, level: 'very-unhealthy' },
        { max: Infinity, level: 'hazardous' }
      ]
    };

    // Default use PM2.5 thresholds
    const paramThresholds = thresholds[parameter] || thresholds.pm25;

    // Find corresponding air quality level
    for (const threshold of paramThresholds) {
      if (value <= threshold.max) {
        return threshold.level;
      }
    }

    return 'unknown';
  };

  // Get air quality description function
  const getAirQualityDescription = (value, parameter) => {
    const level = getAirQualityLevel(value, parameter);

    const descriptions = {
      'good': 'Good: The air quality is satisfactory, with minimal air pollution',
      'moderate': 'Moderate: The air quality is acceptable, but some pollutants may have a minor impact on a very small number of sensitive people',
      'unhealthy-sensitive': 'Unhealthy for Sensitive Groups: Sensitive people should reduce outdoor activity',
      'unhealthy': 'Unhealthy: Everyone should reduce outdoor activity',
      'very-unhealthy': 'Very Unhealthy: Everyone should avoid outdoor activity',
      'hazardous': 'Hazardous: Everyone should avoid outdoor activity',
      'unknown': 'Unknown: Insufficient data to assess air quality'
    };

    return descriptions[level] || descriptions.unknown;
  };

  //    calculate the station color based on the quality level
  const getStationColor = (qualityLevel) => {
    // ensure the color is consistent with the legend
    switch(qualityLevel) {
      case 'good': return '#00E400';  // good (0-50)
      case 'moderate': return '#FFFF00';  // moderate (51-100)
      case 'unhealthy-sensitive': return '#FF7E00';  // unhealthy-sensitive (101-150)
      case 'unhealthy': return '#FF0000';  // unhealthy (151-200)
      case 'very-unhealthy': return '#99004C';  // very-unhealthy (201-300)
      case 'hazardous': return '#7E0023';  // hazardous (>300)
      default: return '#AAAAAA';  // unknown or no data
    }
  };

  // select area to predict air quality
  const handleSelectAreaClick = () => {
    setIsSelectingArea(true);
    setFirstPoint(null);
    setAreaData(null);
    setShowAreaStats(false);
    alert("Please click on any location on the map, the system will predict the air quality of that location. The prediction will be based on the monitoring station data within a 10 km radius.");
  };
  
  // select area to predict air quality
  const handleAreaClick = async (e) => {
    const [longitude, latitude] = e.lngLat.toArray();
    
    // set the selected point
    setFirstPoint({ latitude, longitude });
    setIsLoadingArea(true);
    
    try {
      // automatically adjust the view to the selected point
      setViewport({
        ...viewport,
        latitude: latitude,
        longitude: longitude,
        zoom: Math.min(14, viewport.zoom) // ensure the zoom level is appropriate,放大点以便看到10公里的范围
      });
      
      // parse the prediction time
      const [datePart, timePart] = predictionTime.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hours, minutes] = timePart.split(':').map(Number);
      const selectedDateTime = new Date(year, month - 1, day, hours, minutes);
      
      // format the time display string
      const timeDisplayStr = `${year}-${month}-${day} ${hours}:${minutes}`;
      
      // call the backend prediction API
      const response = await fetch(`${process.env.REACT_APP_API_URL}/api/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          latitude,
          longitude,
          timestamp: selectedDateTime.toISOString(),
          parameter: 'pm25',
          radius: areaRadius // pass the fixed 5 km radius
        })
      });
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} - ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.success) {
        // prediction successful, display the result
        const predictionData = {
          ...result,
          location: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
          queryTime: timeDisplayStr // use the formatted time string
        };
        setPrediction(predictionData);
        setShowPrediction(true);
      } else {
        // prediction failed, display the error information
        setError(result.error || 'Prediction failed');
      }
      
      setIsSelectingArea(false);
    } catch (error) {
      console.error('Error predicting air quality:', error);
      setError(error.message || 'Cannot predict air quality');
    } finally {
      setIsLoadingArea(false);
    }
  };
  
  // keep: cancel area selection
  const cancelAreaSelection = () => {
    setIsSelectingArea(false);
    setFirstPoint(null);
  };
  
  // fix the function to handle time selection change, solve the timezone problem, and add the function to update all station data
  const handleTimeChange = (e) => {
    // parse the selected date time string (already in local time format)
    const selectedValue = e.target.value; // format: "2025-05-03T16:30"
    const [datePart, timePart] = selectedValue.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hours, minutes] = timePart.split(':').map(Number);
    
    // create the local date time object
    const selectedTime = new Date(year, month - 1, day, hours, minutes, 0, 0);
    
    // get the current time and the earliest allowed time (April 30, 2025)
    const now = new Date();
    now.setSeconds(0, 0);
    
    const minAllowedDate = new Date(2025, 3, 30); // 注意月份从0开始，所以4月是3
    
    // check if the selected time is valid
    if (selectedTime > now) {
      alert("Prediction time cannot exceed the current time");
      setPredictionTime(getCurrentTimeISOString());
    } else if (selectedTime < minAllowedDate) {
      alert("Prediction time cannot be earlier than April 30, 2025");
      
      // use the local date time format, set to April 30, 2025
      const year = minAllowedDate.getFullYear();
      const month = String(minAllowedDate.getMonth() + 1).padStart(2, '0');
      const day = String(minAllowedDate.getDate()).padStart(2, '0');
      const hours = String(minAllowedDate.getHours()).padStart(2, '0');
      const minutes = String(minAllowedDate.getMinutes()).padStart(2, '0');
      
      setPredictionTime(`${year}-${month}-${day}T${hours}:${minutes}`);
    } else {
      // the time is valid, use the user's choice
      setPredictionTime(selectedValue);
      console.log(`selected time: ${selectedValue}, time object: ${selectedTime}`);
      
      // get the station data for the selected time
      fetchStationsForTime(selectedTime);
      
      // if there is a selected location, use the new time to update the prediction
      if (selectedLocation) {
        updatePredictionForLocation(selectedLocation.latitude, selectedLocation.longitude);
      }
    }
  };

  // add the function to get the station data for the selected time
  const fetchStationsForTime = async (selectedTime) => {
    try {
      setLoading(true);
      setError(null);
      
      // copy the time object, avoid modifying the original object
      const hourlyTime = new Date(selectedTime);
      // round the time down to the whole hour
      hourlyTime.setMinutes(0, 0, 0);
      
      // use the ISO time format to send the API request
      const timestampISO = hourlyTime.toISOString();
      console.log(`get the station data for the whole hour time ${timestampISO} (original selected time: ${selectedTime.toISOString()})`);
      
      const response = await fetch(`${process.env.REACT_APP_API_URL}/api/stations/at-time`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timestamp: timestampISO
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to get the station data: ${response.status}`);
      }

      const data = await response.json();

      if (!data || !Array.isArray(data)) {
        throw new Error('Invalid API return format');
      }
      
      // add the debug output to check the returned sensor data
      console.log('Example of the station data returned by the backend:', data.length > 0 ? {
        id: data[0].id,
        name: data[0].name,
        sensors: data[0].sensors?.map(s => ({
          parameter: s.parameter?.name,
          value: s.value
        }))
      } : 'no data');

      // add the more detailed debug output
      console.log('AQI calculation debug - pm25 threshold mapping:');
      [0, 35, 75, 115, 150, 250, 350].forEach(testValue => {
        console.log(`When the PM2.5 value is ${testValue}, the corresponding air quality level is: ${getAirQualityLevel(testValue, 'pm25')}, the color is: ${getStationColor(getAirQualityLevel(testValue, 'pm25'))}`);
      });

      // process the station data, add extra information
      const processedStations = data.map(station => {
        // extract the PM2.5 data as the main display data
        const pm25Sensor = station.sensors?.find(s => s.parameter?.name === 'pm25');
        const pm25Value = pm25Sensor?.value !== undefined ? pm25Sensor.value : null;
        const qualityLevel = pm25Value !== null ? getAirQualityLevel(pm25Value, 'pm25') : 'unknown';
        
        // add the debug output
        if (pm25Value !== null) {
          console.log(`The PM2.5 value of station ${station.name || station.id} is ${pm25Value}, the quality level is ${qualityLevel}, the color is ${getStationColor(qualityLevel)}`);
        } else {
          console.log(`Station ${station.name || station.id} has no PM2.5 data`);
        }
        
        return {
          ...station,
          pm25Value,
          qualityLevel
        };
      });
      
      // update the station data and add the debug information
      setStations(processedStations);
      console.log(`Loaded ${processedStations.length} station data`);
      
      // add the extra color statistics debug
      const colorStats = {};
      processedStations.forEach(station => {
        if (station.qualityLevel) {
          colorStats[station.qualityLevel] = (colorStats[station.qualityLevel] || 0) + 1;
        }
      });
      console.log('Station color statistics:', colorStats);
      console.log('The color of each level:', {
        'good': getStationColor('good'),
        'moderate': getStationColor('moderate'),
        'unhealthy-sensitive': getStationColor('unhealthy-sensitive'),
        'unhealthy': getStationColor('unhealthy'),
        'very-unhealthy': getStationColor('very-unhealthy'),
        'hazardous': getStationColor('hazardous'),
        'unknown': getStationColor('unknown')
      });
      
      setLoading(false);
    } catch (error) {
      console.error('Failed to get the station data:', error);
      setError(error.message);
      setLoading(false);
    }
  };

  // update the prediction for the selected location
  const updatePredictionForLocation = async (latitude, longitude) => {
    try {
      // show the loading status
      setPrediction({ loading: true, location: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}` });
      setShowPrediction(true);

      // parse the time string to the date object
      const [datePart, timePart] = predictionTime.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hours, minutes] = timePart.split(':').map(Number);
      const selectedDateTime = new Date(year, month - 1, day, hours, minutes);
      
      // round the time to the whole hour
      const hourlyTime = new Date(selectedDateTime);
      hourlyTime.setMinutes(0, 0, 0);
      
      // format the time display string
      const timeDisplayStr = `${year}-${month}-${day} ${hours}:00`;
      
      // use the backend prediction API
      console.log(`Update prediction: longitude=${longitude}, latitude=${latitude}, whole hour time=${hourlyTime.toISOString()}`);
      
      const response = await fetch(`${process.env.REACT_APP_API_URL}/api/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          latitude,
          longitude,
          timestamp: hourlyTime.toISOString(),
          parameter: 'pm25',
          radius: 5  // fixed use 5 km radius
        }),
      });

      if (!response.ok) {
        throw new Error(`API return error: ${response.status}`);
      }

      const result = await response.json();
      console.log("Prediction API return result:", result);

      if (result.success) {
        // process the successful prediction result
        const predictionData = {
          value: result.value,
          method: result.method,
          stationName: result.station || "Prediction point",
          distance: result.distance || "N/A",
          parameters: { pm25: result.value },
          stations: result.stations,
          unit: result.unit || "µg/m³",
          note: result.note,
          location: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
          queryTime: timeDisplayStr // use the formatted time string
        };
        setPrediction(predictionData);
      } else {
        // 处理错误
        setPrediction({ 
          error: result.error || "Prediction failed",
          location: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
          queryTime: timeDisplayStr // use the formatted time string
        });
        console.error("Prediction error:", result.error);
      }
    } catch (error) {
      console.error("Prediction request failed:", error);
      
      // when the error occurs, get the current selected time again
      const currentTimeStr = (() => {
        try {
          const [datePart, timePart] = predictionTime.split('T');
          const [year, month, day] = datePart.split('-').map(Number);
          const [hours, minutes] = timePart.split(':').map(Number);
          return `${year}-${month}-${day} ${hours}:00`;
        } catch (e) {
          // if the parsing fails, return the simple current time
          return new Date().toLocaleString();
        }
      })();
      
      setPrediction({ 
        error: `Request failed: ${error.message}`,
        location: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
        queryTime: currentTimeStr
      });
    }
  };

  // handle the map click event
  const handleMapClick = async (e) => {
    try {
      //    if the area is being selected, handle the area selection logic
      if (isSelectingArea) {
        handleAreaClick(e);
        return;
      }

      // otherwise, this is a prediction click
      const latitude = e.lngLat.lat;
      const longitude = e.lngLat.lng;

      // save the clicked location
      setSelectedLocation({
        latitude,
        longitude,
        name: `Selected location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`
      });

      // update the prediction
      await updatePredictionForLocation(latitude, longitude);
    } catch (err) {
      console.error("Map click processing error:", err);
    }
  };

  // add the map zoom change listener
  const handleZoomChange = (evt) => {
    setViewport({
      ...viewport,
      zoom: evt.viewState.zoom
    });
  };

  // add the station color debug button
  const debugStationColors = () => {
    console.log('Start debugging station colors...');
    
    // check the station data
    console.log(`Currently loaded ${stations.length} stations`);
    
    // analyze the number of stations for each color level
    const colorStats = {};
    stations.forEach(station => {
      if (station.qualityLevel) {
        colorStats[station.qualityLevel] = (colorStats[station.qualityLevel] || 0) + 1;
      }
    });
    
    // output the test data
    console.log('The number of stations for each air quality level:', colorStats);
    console.log('The color of each AQI level:', {
      'good': getStationColor('good'),
      'moderate': getStationColor('moderate'),
      'unhealthy-sensitive': getStationColor('unhealthy-sensitive'),
      'unhealthy': getStationColor('unhealthy'),
      'very-unhealthy': getStationColor('very-unhealthy'),
      'hazardous': getStationColor('hazardous'),
      'unknown': getStationColor('unknown')
    });
    
    // test the AQI calculation
    const testValues = [10, 45, 75, 125, 175, 250, 350];
    testValues.forEach(value => {
      const level = getAirQualityLevel(value, 'pm25');
      console.log(`When the PM2.5 value is ${value}, the corresponding air quality level is: ${level}, the color is: ${getStationColor(level)}`);
    });
    
    // refresh the station colors
    const refreshedStations = stations.map(station => {
      if (station.pm25Value !== null) {
        const qualityLevel = getAirQualityLevel(station.pm25Value, 'pm25');
        return {
          ...station,
          qualityLevel
        };
      }
      return station;
    });
    
    // update the station data
    setStations(refreshedStations);
    console.log('The station colors have been refreshed');
  };

  if (!process.env.REACT_APP_OPENAQ_API_KEY) {
    return (
      <div className="error-message">
        <h2>Configuration Error</h2>
        <p>Please make sure REACT_APP_OPENAQ_API_KEY is set in the .env file</p>
        <p>You can get an API key from <a href="https://docs.openaq.org/" target="_blank" rel="noopener noreferrer">OpenAQ Documentation</a></p>
      </div>
    );
  }

  if (!MAPBOX_TOKEN) {
    return (
      <div className="error-message">
        <h2>Configuration Error</h2>
        <p>Please make sure REACT_APP_MAPBOX_TOKEN is set in the .env file</p>
        <p>You can get an access token from <a href="https://account.mapbox.com/" target="_blank" rel="noopener noreferrer">Mapbox Account</a></p>
      </div>
    );
  }

  return (
    <div className="home-container">
      <div className="controls">
        <h2>air quality monitoring and prediction</h2>
        <div className="control-row">
          <label htmlFor="prediction-time" className="time-label">prediction time:</label>
          <input 
            type="datetime-local" 
            id="prediction-time" 
            value={predictionTime} 
            onChange={handleTimeChange}
            min={timeConstraints.min}
            max={timeConstraints.max}
            className="time-picker"
          />
          <span className="time-hint">Select the time point to query (from April 30, 2025 onwards, display the data at the whole hour)</span>
        </div>
        <div className="control-buttons">
          <button 
            className={isSelectingArea ? 'active' : ''} 
            onClick={handleSelectAreaClick}
          >
            {isSelectingArea ? 'Cancel prediction' : 'Predict air quality'}
          </button>
          {firstPoint && (
            <button onClick={cancelAreaSelection}>Clear selection</button>
          )}
          
          <button 
            className={showAllStations ? 'active' : ''} 
            onClick={() => setShowAllStations(!showAllStations)}
          >
            {showAllStations ? 'Hide stations' : 'Show all stations'}
          </button>
          
          {/* add the debug button */}
          <button onClick={debugStationColors} style={{backgroundColor: '#9c27b0'}}>
            Refresh station colors
          </button>
          
          <span className="station-count">Currently there are {stations.length} stations</span>
        </div>
        {error && <div className="error-message">{error}</div>}
      </div>

      <div className="flex-1 relative map-container">
        {!mapLoaded && !error && (
          <div className="loading">
            <div className="spinner"></div>
            <span>Loading...</span>
          </div>
        )}

        {isLoadingArea && (
          <div className="area-loading">
            <div className="spinner"></div>
            <span>Getting the area data...</span>
          </div>
        )}

        {!MAPBOX_TOKEN ? (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
            <div className="text-center p-4 bg-white rounded-lg shadow-lg">
              <h2 className="text-xl font-bold text-red-600 mb-2">Error</h2>
              <p>Mapbox access token not set, please check .env file</p>
            </div>
          </div>
        ) : (
          <Map
            {...viewport}
            onMove={evt => setViewport(evt.viewport)}
            style={{ width: '100%', height: '100%' }}
            mapStyle="mapbox://styles/mapbox/light-v10"
            mapboxAccessToken={MAPBOX_TOKEN}
            onClick={handleMapClick}
            onZoom={handleZoomChange}
            onLoad={() => {
              setMapLoaded(true);
            }}
            initialViewState={viewport}
            maxBounds={[
              [-119.0, 33.5], // Southwest corner (longitude, latitude)
              [-117.5, 34.4]  // Northeast corner (longitude, latitude)
            ]}
          >
            <NavigationControl position="top-right" />
            <FullscreenControl position="top-right" />

            {/* show all stations */}
            {showAllStations && stations && stations.length > 0 && stations.map((station) => {
              if (!station.coordinates || !station.coordinates.latitude || !station.coordinates.longitude) {
                return null;
              }
                
              // select the station marker color
              const markerColor = getStationColor(station.qualityLevel);
              
              return (
                <Marker
                  key={station.id}
                  latitude={station.coordinates.latitude}
                  longitude={station.coordinates.longitude}
                >
                  <div
                    className="station-marker"
                    style={{
                      backgroundColor: markerColor
                    }}
                    title={station.name}
                    onClick={(e) => {
                      e.stopPropagation();
                      // extract the sensor data
                      const parameters = {};
                      const paramNames = ['pm25', 'pm10', 'o3', 'no2', 'so2', 'co'];
                      paramNames.forEach(paramName => {
                        const sensor = station.sensors?.find(s => s.parameter?.name === paramName);
                        if (sensor && sensor.value !== undefined) {
                          parameters[paramName] = sensor.value;
                        }
                      });
                      
                      // set the selected station
                      setSelectedPoint({
                        ...station.coordinates,
                        name: station.name,
                        value: station.pm25Value !== null ? station.pm25Value : '数据不可用',
                        parameters: parameters,
                        qualityLevel: station.qualityLevel,
                        qualityColor: markerColor
                      });
                    }}
                  />
                </Marker>
              );
            })}

            {selectedPoint && (
              <Marker
                latitude={selectedPoint.latitude}
                longitude={selectedPoint.longitude}
              >
                <div className="w-4 h-4 bg-red-500 rounded-full" />
              </Marker>
            )}

            {selectedPoint && selectedPoint.name && (
              <Popup
                latitude={selectedPoint.latitude}
                longitude={selectedPoint.longitude}
                onClose={() => setSelectedPoint(null)}
                closeButton={true}
                closeOnClick={false}
                className="popup"
              >
                <div>
                  <h3 className="popup-title">{selectedPoint.name}</h3>
                  <p className="popup-value"><strong>PM2.5:</strong> {selectedPoint.value} µg/m³</p>

                  {selectedPoint.parameters && (
                    <div className="mt-2">
                      <p className="text-sm font-semibold mb-1">Other metrics:</p>
                      <ul className="text-xs space-y-1">
                        {selectedPoint.parameters.pm10 !== undefined && (
                          <li className="popup-value">PM10: {selectedPoint.parameters.pm10.toFixed(2)} µg/m³</li>
                        )}
                        {selectedPoint.parameters.o3 !== undefined && (
                          <li className="popup-value">Ozone(O3): {selectedPoint.parameters.o3.toFixed(2)} µg/m³</li>
                        )}
                        {selectedPoint.parameters.no2 !== undefined && (
                          <li className="popup-value">Nitrogen Dioxide(NO2): {selectedPoint.parameters.no2.toFixed(2)} µg/m³</li>
                        )}
                        {selectedPoint.parameters.so2 !== undefined && (
                          <li className="popup-value">Sulfur Dioxide(SO2): {selectedPoint.parameters.so2.toFixed(2)} µg/m³</li>
                        )}
                        {selectedPoint.parameters.co !== undefined && (
                          <li className="popup-value">Carbon Monoxide(CO): {selectedPoint.parameters.co.toFixed(2)} mg/m³</li>
                        )}
                      </ul>
                    </div>
                  )}

                  {selectedPoint.qualityLevel && (
                    <div className={`popup-quality quality-${selectedPoint.qualityLevel}`} style={{backgroundColor: selectedPoint.qualityColor, color: selectedPoint.qualityLevel === 'good' || selectedPoint.qualityLevel === 'moderate' ? '#000' : '#fff'}}>
                      {getAirQualityDescription(selectedPoint.value, 'pm25')}
                    </div>
                  )}

                  <p className="popup-footer">Coordinates: {selectedPoint.latitude.toFixed(4)}, {selectedPoint.longitude.toFixed(4)}</p>
                </div>
              </Popup>
            )}

            {selectedPoint && !selectedPoint.name && selectedPoint.predicted !== undefined && (
              <Popup
                latitude={selectedPoint.latitude}
                longitude={selectedPoint.longitude}
                onClose={() => setSelectedPoint(null)}
                closeButton={true}
                closeOnClick={false}
                className="popup"
              >
                <div className="p-2 max-w-sm">
                  <h3 className="font-bold text-md">Air Quality Prediction</h3>
                  <p className="font-semibold">PM2.5: {typeof selectedPoint.predicted === 'number' ? selectedPoint.predicted.toFixed(2) : selectedPoint.predicted} µg/m³</p>
                  {selectedPoint.parameters && (
                    <div className="mt-2">
                      <p className="text-sm font-semibold mb-1">Other Metrics:</p>
                      <ul className="text-xs space-y-1">
                        {selectedPoint.parameters.pm10 !== undefined && (
                          <li>PM10: {selectedPoint.parameters.pm10.toFixed(2)} µg/m³</li>
                        )}
                        {selectedPoint.parameters.o3 !== undefined && (
                          <li>Ozone(O3): {selectedPoint.parameters.o3.toFixed(2)} µg/m³</li>
                        )}
                        {selectedPoint.parameters.no2 !== undefined && (
                          <li>Nitrogen Dioxide(NO2): {selectedPoint.parameters.no2.toFixed(2)} µg/m³</li>
                        )}
                        {selectedPoint.parameters.so2 !== undefined && (
                          <li>Sulfur Dioxide(SO2): {selectedPoint.parameters.so2.toFixed(2)} µg/m³</li>
                        )}
                        {selectedPoint.parameters.co !== undefined && (
                          <li>Carbon Monoxide(CO): {selectedPoint.parameters.co.toFixed(2)} mg/m³</li>
                        )}
                      </ul>
                    </div>
                  )}
                  <p className="text-xs mt-2" style={{ color: selectedPoint.qualityColor || 'black', fontWeight: 'bold' }}>
                    Air Quality: {selectedPoint.qualityLevel || 'Unknown'}
                  </p>
                  <p className="text-xs text-gray-500">Data Source: {selectedPoint.source || 'IDW Model Prediction'}</p>
                  {selectedPoint.stationName && (
                    <p className="text-xs text-gray-500">Station: {selectedPoint.stationName}</p>
                  )}
                  {selectedPoint.distance && (
                    <p className="text-xs text-gray-500">Distance: {selectedPoint.distance} km</p>
                  )}
                  <p className="text-xs text-gray-500">Coordinates: {selectedPoint.latitude.toFixed(4)}, {selectedPoint.longitude.toFixed(4)}</p>
                  <p className="text-xs text-gray-500">Prediction Time: {selectedPoint.queryTime}</p>
                </div>
              </Popup>
            )}

            {/* show the selected point */}
            {firstPoint && (
              <Marker
                latitude={firstPoint.latitude}
                longitude={firstPoint.longitude}
              >
                <div className="w-4 h-4 bg-blue-500 rounded-full border-2 border-white" />
              </Marker>
            )}
            
            {/* show the area circle - using the Mapbox GL Source and Layer components, fixed radius of 10 km */}
            {firstPoint && (
              <Source
                id="area-circle"
                type="geojson"
                data={{
                  type: 'Feature',
                  geometry: {
                    type: 'Point',
                    coordinates: [firstPoint.longitude, firstPoint.latitude]
                  },
                  properties: {
                    radius: 5 // fixed radius of 5 km
                  }
                }}
              >
                <Layer
                  id="area-circle-layer"
                  type="circle"
                  paint={{
                    // use the expression to calculate the pixel radius based on the current zoom level and the actual physical radius
                    'circle-radius': [
                      'interpolate',
                      ['exponential', 2],
                      ['zoom'],
                      // different radius sizes at different zoom levels
                      5, ['*', ['get', 'radius'], 0.05],
                      8, ['*', ['get', 'radius'], 0.5],
                      10, ['*', ['get', 'radius'], 2],
                      12, ['*', ['get', 'radius'], 8],
                      14, ['*', ['get', 'radius'], 30],
                      16, ['*', ['get', 'radius'], 120],
                      18, ['*', ['get', 'radius'], 500]
                    ],
                    'circle-color': 'rgba(0, 100, 255, 0.15)',
                    'circle-stroke-width': 2,
                    'circle-stroke-color': 'rgb(0, 100, 255)',
                    'circle-opacity': 0.7
                  }}
                />
              </Source>
            )}

            {/* add the air quality legend */}
            {showAllStations && (
              <div className="map-legend">
                <div className="legend-title">Air Quality Index (AQI)</div>
                <div className="legend-item">
                  <div className="legend-color" style={{backgroundColor: '#00E400'}}></div>
                  <div className="legend-label">excellent (0-50)</div>
                </div>
                <div className="legend-item">
                  <div className="legend-color" style={{backgroundColor: '#FFFF00'}}></div>
                  <div className="legend-label">good (51-100)</div>
                </div>
                <div className="legend-item">
                  <div className="legend-color" style={{backgroundColor: '#FF7E00'}}></div>
                  <div className="legend-label">moderate (101-150)</div>
                </div>
                <div className="legend-item">
                  <div className="legend-color" style={{backgroundColor: '#FF0000'}}></div>
                  <div className="legend-label">unhealthy-sensitive (151-200)</div>
                </div>
                <div className="legend-item">
                  <div className="legend-color" style={{backgroundColor: '#99004C'}}></div>
                  <div className="legend-label">unhealthy (201-300)</div>
                </div>
                <div className="legend-item">
                  <div className="legend-color" style={{backgroundColor: '#7E0023'}}></div>
                  <div className="legend-label">hazardous (&gt;300)</div>
                </div>
                <div className="legend-item">
                  <div className="legend-color" style={{backgroundColor: '#AAAAAA'}}></div>
                  <div className="legend-label">no data</div>
                </div>
              </div>
            )}
          </Map>
        )}
      </div>

      <div className="w-full p-4 bg-white shadow-lg">
        <h2 className="text-xl font-bold mb-4">Air Quality Prediction</h2>
        {loading && (
          <div className="loading">
            <div className="spinner"></div>
            <span>Loading...</span>
          </div>
        )}
        {error && (
          <div className="p-4 bg-red-100 rounded-lg">
            <p className="text-red-600">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              Retry
            </button>
          </div>
        )}
        {showPrediction && prediction && (
          <div className="prediction-panel">
            {prediction.loading ? (
              <div className="loading-prediction">
                <div className="spinner"></div>
                <p> predicting...</p>
              </div>
            ) : prediction.error ? (
              <div className="prediction-error">
                <h3>Prediction error</h3>
                <p>{prediction.error}</p>
                <p className="location">{prediction.location}</p>
                <p className="time-info">Query time: {prediction.queryTime}</p>
              </div>
            ) : (
              <div className="prediction-results">
                <div className="time-badge">
                  <span className="time-icon">🕒</span>
                  <span className="time-text">{prediction.queryTime}</span>
                </div>
                <h3>Air quality prediction results</h3>
                <p><strong>Location:</strong> {prediction.location}</p>
                <p><strong>Query time:</strong> {prediction.queryTime}</p>
                <p><strong>Search range:</strong> 5 km</p>
                <p><strong>Prediction method:</strong> {
                  prediction.method === 'direct' ? 'Direct match' : 
                  prediction.method === 'sensor' ? 'Sensor data' : 
                  prediction.method === 'idw' ? 'Distance weighted interpolation' :
                  prediction.method === 'nearest' ? 'Nearest station' : 
                  prediction.method
                }</p>
                <div className={`air-quality-value ${getAirQualityLevel(prediction.value, 'pm25')}`}>
                  <span className="value">{prediction.value}</span>
                  <span className="unit">{prediction.unit}</span>
                </div>
                <p className="quality-description">
                  {getAirQualityDescription(prediction.value, 'pm25')}
                </p>
                {prediction.note && (
                  <p className="prediction-note">{prediction.note}</p>
                )}
                <p className="station-info">Data source: {prediction.stationName} ({prediction.distance} km)</p>
              </div>
            )}
            <button 
              className="close-prediction" 
              onClick={() => setShowPrediction(false)}
            >
              ✕
            </button>
          </div>
        )}

        {historicalData.length > 0 && !loading && !error && (
          <div className="mt-4">
            <h3 className="text-lg font-bold mb-2">Historical Trends</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={historicalData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="value" stroke="#8884d8" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* show the area stats */}
      {showAreaStats && areaData && (
        <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-4 rounded-lg shadow-lg z-50 max-w-md w-full">
          <h3 className="text-lg font-bold mb-2">Area air quality statistics</h3>
          <p className="text-sm mb-2">
            选中点: {firstPoint.latitude.toFixed(4)}, {firstPoint.longitude.toFixed(4)}
          </p>
          <p className="text-sm mb-2">Area radius: {areaRadius} km</p>
          <p className="text-sm mb-2">Number of monitoring stations in the area: {areaData.stationCount}</p>
          
          <div className="mt-3">
            <h4 className="font-semibold">Average air quality index:</h4>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {Object.entries(areaData.averages).map(([key, value]) => (
                <div key={key} className="bg-gray-100 p-2 rounded">
                  <span className="font-medium">{key}: </span>
                  <span>{value !== null ? value.toFixed(2) : '暂无数据'}</span>
                  {areaData.counts[key] && (
                    <span className="text-xs text-gray-500 block">
                      (Based on {areaData.counts[key]} monitoring stations)
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
          
          <button
            onClick={() => setShowAreaStats(false)}
            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 w-full"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
};

// add the CSS styles
const styles = `
.station-count {
  margin-left: 10px;
  font-size: 0.9em;
  color: #666;
}

.station-marker:hover {
  transform: scale(1.5);
  z-index: 10;
}

.active-button {
  background-color: #4CAF50;
  color: white;
}
`;

// add the styles to the document
const styleSheet = document.createElement("style");
styleSheet.type = "text/css";
styleSheet.innerText = styles;
document.head.appendChild(styleSheet);

export default Home; 