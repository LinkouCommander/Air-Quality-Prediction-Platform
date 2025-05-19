# Air Quality Prediction System

## Project Overview
An ML-based air quality prediction system built with React frontend, Node.js backend, and AWS Lambda services. The system collects, analyzes, and predicts air quality data for the Los Angeles area in real-time.

## Repository Structure
```
.
├── frontend/          # React frontend application
	├── src/           # css and js files
		├── ...        
	├── public		   # images, icon, etc.
		├── ...
	├── .env		   # environment variables, e.g. API keys
├── backend/           # Node.js/Express backend server
	├── services/      # data collection and prediction
		├── ...
	├── models/		   # database related
		├── ...
├── air-lambda/        # AWS Lambda functions
├── terraform/         # Infrastructure as Code
├── manifest.md        # Project manifest file
└── README.md          # This file
```

## Technical Requirements
- Node.js >= 14.x
- MongoDB >= 4.4
- AWS CLI configured
- Python 3.8+ (for Lambda functions)
- npm or yarn package manager

## Setup and Installation

### Frontend Setup
1. Navigate to frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Start development server:
```bash
npm start
```

### Backend Setup
1. Navigate to backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Start server:
```bash
npm start
```

### Lambda Deployment
1. Navigate to air-lambda directory:
```bash
cd air-lambda
```

2. Install dependencies:
```bash
npm install
```

3. Configure AWS credentials:
```bash
aws configure
```

4. Deploy Lambda function:
```bash
./deploy.sh
```

## Configuration Details

### Environment Variables
Required environment variables for each component:

#### Frontend (.env)
```
REACT_APP_API_URL=http://localhost:8080
REACT_APP_MAP_API_KEY=your_map_api_key
```

#### Backend (.env)
```
MONGODB_URI=mongodb://localhost:27017/airquality
PORT=8080
AWS_REGION=us-west-2
```

#### Lambda (.env)
```
AWS_REGION=us-west-2
MONGODB_URI=your_mongodb_uri
```

## API Documentation

### Backend APIs
- `GET /api/stations` - Get all monitoring station information
- `POST /api/predict` - Get air quality predictions
- `POST /api/area-stats` - Get area statistics
- `POST /api/historical-data` - Get historical data

### Lambda Functions
- Hourly OpenAQ data synchronization
- Historical data generation
- Data cleanup

## Testing and Validation

### Current Testing Status
This project currently does not have a formal testing framework implemented. The system's functionality has been verified through:

1. **Basic Functionality Verification**
   - Manual verification of API endpoints through direct usage
   - Basic system integration checks during development
   - Ad-hoc testing of core features

### Future Testing Improvements
To ensure system reliability and maintainability, the following testing implementations are recommended:

1. **Unit Testing**
   - Implement Jest for backend API testing
   - Add React Testing Library for frontend components
   - Create test cases for prediction algorithms

2. **Integration Testing**
   - Test API endpoints with proper test data
   - Verify database operations
   - Test Lambda function integration

3. **End-to-End Testing**
   - Implement Cypress for frontend testing
   - Test complete user workflows
   - Verify data flow between components

4. **Performance Testing**
   - Load testing for API endpoints
   - Response time monitoring
   - Database query optimization

## Troubleshooting
1. Check environment variable configuration
2. Verify MongoDB connection
3. Confirm API key validity
4. Check Lambda function logs
