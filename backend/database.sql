CREATE TABLE IF NOT EXISTS mvps (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  base_time_mins INTEGER NOT NULL,
  last_kill_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO mvps (name, base_time_mins) VALUES 
('Baphomet', 120),
('Eddga', 120),
('Maya', 120);
