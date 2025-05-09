import React from 'react';

const About = () => {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6"> About Air Quality Monitoring System</h1>
      <div className="prose max-w-none">
        <p className="mb-4">
          This is an air quality monitoring system based on React and Mapbox, which can display real-time air quality data and make predictions.
        </p>
        <h2 className="text-2xl font-bold mt-6 mb-4">Main Features</h2>
        <ul className="list-disc pl-6 mb-4">
          <li>Display real-time air quality data from monitoring stations</li>
          <li>Use Inverse Distance Weighting (IDW) for air quality prediction</li>
          <li>Historical data trend analysis</li>
          <li>Interactive map display</li>
        </ul>
        <h2 className="text-2xl font-bold mt-6 mb-4">Technologies Used</h2>
        <ul className="list-disc pl-6 mb-4">
          <li>React</li>
          <li>Mapbox GL JS</li>
          <li>Recharts</li>
          <li>Tailwind CSS</li>
        </ul>
      </div>
    </div>
  );
};

export default About; 