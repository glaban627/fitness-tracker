const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();

// IMPORTANT: Render requires process.env.PORT
const PORT = process.env.PORT || 3000;

// Database file path
const DB_PATH = path.join(__dirname, 'database.json');

// --- Middleware ---
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// --- Serve frontend files (VERY IMPORTANT FOR RENDER) ---
// This tells Express to serve static files (html, css, js) from the current directory
app.use(express.static(path.join(__dirname)));

// Route for the homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// --- Database Helpers ---
const initDb = async () => {
  try {
    await fs.access(DB_PATH);
  } catch {
    console.log('Initializing new database...');
    const initialData = { users: [], workouts: [] };
    await fs.writeFile(DB_PATH, JSON.stringify(initialData, null, 2));
  }
};

const readDb = async () => {
  try {
    const data = await fs.readFile(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return { users: [], workouts: [] };
  }
};

const writeDb = async (data) => {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
};

// --- Helper: Validation ---
const isValidGmail = (email) => {
  const emailRegex = /^[a-z0-9](\.?[a-z0-9]){1,}@gmail\.com$/;
  return emailRegex.test(email);
};

// --- REST API Endpoints ---

// 1. Register (Enhanced)
app.post('/api/register', async (req, res) => {
  try {
    let { username, password, fullName } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Missing username or password' });
    }

    const normalizedUser = username.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (!isValidGmail(normalizedUser)) {
      return res.status(400).json({ error: 'Registration is restricted to @gmail.com addresses only.' });
    }

    if (cleanPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    const db = await readDb();

    if (db.users.find(u => u.username === normalizedUser)) {
      return res.status(409).json({ error: 'Account already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(cleanPassword, salt);

    const newUser = {
      id: Date.now(),
      username: normalizedUser,
      password: hashedPassword,
      fullName: fullName ? fullName.trim() : '',
      joinedDate: new Date().toISOString(),
      profile: {
        age: 0,
        weight: 0,
        height: 0,
        goalWeight: 0,
        dailyCalorieGoal: 2000,
        activityLevel: 'moderate'
      }
    };

    db.users.push(newUser);
    await writeDb(db);

    const { password: _, ...userSafe } = newUser;
    res.status(201).json(userSafe);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 2. Login (Enhanced)
app.post('/api/login', async (req, res) => {
  try {
    let { username, password } = req.body;
    
    if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

    const normalizedUser = username.trim().toLowerCase();
    
    const db = await readDb();
    const user = db.users.find(u => u.username === normalizedUser);

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

    const { password: _, ...userSafe } = user;
    res.json(userSafe);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. Get Workouts
app.get('/api/workouts', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const db = await readDb();
    const workouts = db.workouts
      .filter(w => w.userId === Number(userId))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
      
    res.json(workouts);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. Add Workout (Enhanced Validation)
app.post('/api/workouts', async (req, res) => {
  try {
    const { userId, type, duration, calories, date, notes, intensity } = req.body;
    
    if (!userId || !type) return res.status(400).json({ error: 'Missing required fields' });
    if (Number(duration) < 0 || Number(calories) < 0) {
      return res.status(400).json({ error: 'Duration and calories cannot be negative' });
    }

    const db = await readDb();
    
    const userExists = db.users.some(u => u.id === Number(userId));
    if (!userExists) return res.status(404).json({ error: 'User ID not found' });

    const newWorkout = {
      id: Date.now(),
      userId: Number(userId),
      type: type.trim(),
      duration: Number(duration) || 0,
      calories: Number(calories) || 0,
      date: date || new Date().toISOString(),
      notes: notes ? notes.trim() : '',
      intensity: intensity || 'medium',
      timestamp: new Date().toISOString()
    };

    db.workouts.push(newWorkout);
    await writeDb(db);
    res.status(201).json(newWorkout);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 5. Edit Workout
app.put('/api/workouts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const db = await readDb();
    
    const index = db.workouts.findIndex(w => w.id === Number(id));
    if (index === -1) return res.status(404).json({ error: 'Workout not found' });

    if (updates.type) updates.type = updates.type.trim();
    if (updates.notes) updates.notes = updates.notes.trim();

    db.workouts[index] = { ...db.workouts[index], ...updates };
    db.workouts[index].id = Number(id); 
    
    await writeDb(db);
    res.json(db.workouts[index]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 6. Delete Workout
app.delete('/api/workouts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = await readDb();
    
    const initialLen = db.workouts.length;
    db.workouts = db.workouts.filter(w => w.id !== Number(id));
    
    if (db.workouts.length === initialLen) return res.status(404).json({ error: 'Not found' });

    await writeDb(db);
    res.sendStatus(204);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 7. Update Profile
app.put('/api/profile', async (req, res) => {
  try {
    const { userId, ...stats } = req.body;
    const db = await readDb();
    
    const userIndex = db.users.findIndex(u => u.id === Number(userId));
    if (userIndex === -1) return res.status(404).json({ error: 'User not found' });

    db.users[userIndex].profile = {
      ...db.users[userIndex].profile,
      ...stats
    };

    await writeDb(db);
    const { password: _, ...userSafe } = db.users[userIndex];
    res.json(userSafe);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 8. Health Check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date() });
});

// --- Start server ---
initDb().then(() => {
  app.listen(PORT, () => console.log(`FitTrack Pro Server running on port ${PORT}`));
});
