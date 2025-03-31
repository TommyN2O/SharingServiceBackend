# Sharing Service Backend

A backend service built with Express.js and PostgreSQL.

## Prerequisites

- Node.js (v14 or higher)
- PostgreSQL
- npm or yarn

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a PostgreSQL database named `sharing_service_db`
4. Copy `.env.example` to `.env` and update the database credentials:
   ```
   PORT=3000
   DB_USER=your_username
   DB_HOST=localhost
   DB_NAME=sharing_service_db
   DB_PASSWORD=your_password
   DB_PORT=5432
   ```

## Running the Application

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## API Endpoints

- GET `/`: Welcome message

## Testing

Run tests:
```bash
npm test
``` 