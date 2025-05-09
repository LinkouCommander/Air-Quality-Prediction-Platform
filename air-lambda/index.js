// index.js
// Lambda函数入口点，符合默认处理程序配置

// import the main implementation file
const { handler } = require('./la-hourly-sync');

// export the handler function to be compatible with the default configuration
exports.handler = async (event, context) => {
  console.log('Calling the handler through the index file...');
  return await handler(event, context);
}; 