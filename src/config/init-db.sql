-- Drop existing tables if they exist
DROP TABLE IF EXISTS task_request_gallery CASCADE;
DROP TABLE IF EXISTS task_request_availability CASCADE;
DROP TABLE IF EXISTS task_request_categories CASCADE;
DROP TABLE IF EXISTS task_requests CASCADE;
DROP TABLE IF EXISTS tasker_gallery CASCADE;
DROP TABLE IF EXISTS tasker_availability CASCADE;
DROP TABLE IF EXISTS tasker_cities CASCADE;
DROP TABLE IF EXISTS tasker_categories CASCADE;
DROP TABLE IF EXISTS tasker_profiles CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS cities CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Create users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    surname VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_tasker BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create cities table
CREATE TABLE cities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create categories table
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    image_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create tasker_profiles table
CREATE TABLE tasker_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    profile_photo TEXT,
    description TEXT,
    hourly_rate DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

-- Create task_requests table
CREATE TABLE task_requests (
    id SERIAL PRIMARY KEY,
    description TEXT NOT NULL,
    city_id INTEGER REFERENCES cities(id),
    duration TEXT NOT NULL,
    sender_id INTEGER REFERENCES users(id),
    tasker_id INTEGER REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create task_request_categories table
CREATE TABLE task_request_categories (
    task_request_id INTEGER REFERENCES task_requests(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (task_request_id, category_id)
);

-- Create task_request_availability table
CREATE TABLE task_request_availability (
    task_request_id INTEGER REFERENCES task_requests(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    time_slot TIME NOT NULL,
    PRIMARY KEY (task_request_id, date, time_slot)
);

-- Create task_request_gallery table
CREATE TABLE task_request_gallery (
    id SERIAL PRIMARY KEY,
    task_request_id INTEGER REFERENCES task_requests(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create messages table
CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    sender_id INTEGER REFERENCES users(id),
    receiver_id INTEGER REFERENCES users(id),
    content TEXT NOT NULL,
    type VARCHAR(20) DEFAULT 'message',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    seen BOOLEAN DEFAULT FALSE
);

-- Create indexes for better performance
CREATE INDEX idx_task_requests_sender ON task_requests(sender_id);
CREATE INDEX idx_task_requests_tasker ON task_requests(tasker_id);
CREATE INDEX idx_task_requests_city ON task_requests(city_id);
CREATE INDEX idx_task_request_categories_task ON task_request_categories(task_request_id);
CREATE INDEX idx_task_request_availability_task ON task_request_availability(task_request_id);
CREATE INDEX idx_task_request_gallery_task ON task_request_gallery(task_request_id);
CREATE INDEX idx_messages_sender_receiver ON messages(sender_id, receiver_id);

-- Insert some test data
INSERT INTO cities (name) VALUES ('Test City') ON CONFLICT (name) DO NOTHING;
INSERT INTO categories (name, description) 
VALUES ('Cleaning', 'House cleaning services') 
ON CONFLICT (name) DO NOTHING; 