require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'rune_midgard_super_secret_key_2026';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 1. Corrección en process.env.DB_NAME
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// 2. Test de conexión explícito
pool.connect()
  .then(client => {
    console.log(`¡Conectado exitosamente a la base de datos: ${client.database}!`);
    return client.query(`
      CREATE TABLE IF NOT EXISTS user_mvp_kills (
        user_id INTEGER REFERENCES users(id),
        mvp_id INTEGER REFERENCES mvps(id),
        last_kill_time TIMESTAMP,
        PRIMARY KEY (user_id, mvp_id)
      );
    `).then(() => {
      console.log('Tabla user_mvp_kills verificada/creada.');
      client.release();
    });
  })
  .catch(err => console.error('Error al conectar a PostgreSQL:', err.stack));

// Middleware para verificar JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Acceso denegado. Token faltante.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido o expirado.' });
    req.user = user;
    next();
  });
};

// POST /api/auth/login - Autenticación de usuario
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  console.log(`[LOGIN] Intento de login para usuario: '${username}'`);
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      console.log(`[LOGIN] Usuario '${username}' no encontrado en la DB.`);
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    
    const user = result.rows[0];
    console.log(`[LOGIN] Usuario encontrado en DB. Evaluando password...`);
    const match = await bcrypt.compare(password, user.password);
    console.log(`[LOGIN] Resultado bcrypt.compare para '${username}': ${match}`);
    
    if (!match) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
    console.log(`[LOGIN] Login exitoso para '${username}'. Retornando token.`);
    res.json({ token });
  } catch (err) {
    console.error('[LOGIN ERROR]', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/auth/register - Crear un nuevo usuario
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    if (!username || !password) {
      return res.status(400).json({ error: 'Username y password son obligatorios' });
    }

    // Verificar si el usuario ya existe
    const exists = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'El nombre de usuario ya está en uso' });
    }

    // Hashear contraseña y guardar
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username',
      [username, hashedPassword]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[REGISTER ERROR]', err);
    res.status(500).json({ error: 'Error interno del servidor al registrar' });
  }
});

// GET /api/mvps - Obtener MVPs con su hora de última muerte (por usuario)
app.get('/api/mvps', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT m.id, m.name, m.base_time_mins, uk.last_kill_time 
       FROM mvps m 
       LEFT JOIN user_mvp_kills uk ON m.id = uk.mvp_id AND uk.user_id = $1 
       ORDER BY m.id ASC`, 
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/mvps/:id/kill - Actualizar hora de muerte al tiempo actual (por usuario)
app.post('/api/mvps/:id/kill', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { killTime } = req.body;
  const userId = req.user.id;
  try {
    let query;
    let params;
    
    if (killTime) {
      query = `
        INSERT INTO user_mvp_kills (user_id, mvp_id, last_kill_time) 
        VALUES ($1, $2, $3) 
        ON CONFLICT (user_id, mvp_id) 
        DO UPDATE SET last_kill_time = EXCLUDED.last_kill_time 
        RETURNING *`;
      params = [userId, id, killTime];
    } else {
      query = `
        INSERT INTO user_mvp_kills (user_id, mvp_id, last_kill_time) 
        VALUES ($1, $2, CURRENT_TIMESTAMP) 
        ON CONFLICT (user_id, mvp_id) 
        DO UPDATE SET last_kill_time = EXCLUDED.last_kill_time 
        RETURNING *`;
      params = [userId, id];
    }

    await pool.query(query, params);
    
    // Devolver el MVP fusionado
    const mvpResult = await pool.query(
      `SELECT m.id, m.name, m.base_time_mins, uk.last_kill_time 
       FROM mvps m 
       LEFT JOIN user_mvp_kills uk ON m.id = uk.mvp_id AND uk.user_id = $1 
       WHERE m.id = $2`,
      [userId, id]
    );
    
    if (mvpResult.rows.length === 0) {
      return res.status(404).json({ error: 'MVP not found' });
    }
    res.json(mvpResult.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/mvps/:id/reset - Poner last_kill_time en NULL (por usuario)
app.post('/api/mvps/:id/reset', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    await pool.query('DELETE FROM user_mvp_kills WHERE user_id = $1 AND mvp_id = $2', [userId, id]);
    
    const mvpResult = await pool.query(
      `SELECT m.id, m.name, m.base_time_mins, uk.last_kill_time 
       FROM mvps m 
       LEFT JOIN user_mvp_kills uk ON m.id = uk.mvp_id AND uk.user_id = $1 
       WHERE m.id = $2`,
      [userId, id]
    );
    
    if (mvpResult.rows.length === 0) {
      return res.status(404).json({ error: 'MVP not found' });
    }
    res.json(mvpResult.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});