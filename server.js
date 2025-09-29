const express = require('express');
const path = require('path');
const app = express();

// ---------- Healthcheck ----------
app.get('/health', (_, res) => res.status(200).send('ok'));

// ---------- Static ----------
app.use(express.static(path.join(__dirname)));

// ---------- Config ----------
const WEATHER_KEY = process.env.WEATHER_KEY;
const WEATHER_STATION_ID = process.env.WEATHER_STATION_ID || 'IALFAR32';
if (!WEATHER_KEY) console.warn('⚠️ Falta WEATHER_KEY en variables de entorno');

// ---------- Helper robusto (maneja 204 y no-JSON) ----------
async function getJSON(url) {
  const r = await fetch(url);
  const text = await r.text();
  if (r.status === 204 || text.trim() === '') return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0,200)}`);
  try { return JSON.parse(text); } 
  catch { throw new Error(`Respuesta no JSON: ${text.slice(0,120)}`); }
}

// ---------- Cache en memoria ----------
const cache = new Map();
function setCache(key, data, ttlMs){ cache.set(key, { data, exp: Date.now() + ttlMs }); }
function getCache(key){ const v = cache.get(key); if(!v) return null; if(Date.now()>v.exp){ cache.delete(key); return null;} return v.data; }

// ---------- Proxy: Observaciones ----------
app.get('/api/observations', async (req, res) => {
  try {
    const stationId = req.query.stationId || WEATHER_STATION_ID;
    const cacheKey = `obs:${stationId}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const url = `https://api.weather.com/v2/pws/observations/current?stationId=${encodeURIComponent(stationId)}&format=json&units=m&apiKey=${encodeURIComponent(WEATHER_KEY)}`;
    const data = await getJSON(url);

    if (!data || !Array.isArray(data.observations)) {
      const safe = { observations: [] };
      setCache(cacheKey, safe, 30 * 1000);
      return res.json(safe);
    }

    setCache(cacheKey, data, 60 * 1000);
    res.json(data);
  } catch (err) {
    console.error('❌ /api/observations:', err.message);
    res.status(502).json({ observations: [], error: 'Observations unavailable', detail: err.message });
  }
});

// ---------- Proxy: Pronóstico (7 días) ----------
app.get('/api/forecast', async (req, res) => {
  try {
    const { lat = '36.997', lon = '-4.262' } = req.query; // Alfarnate aprox
    const cacheKey = `fc:${lat},${lon}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const url = `https://api.weather.com/v3/wx/forecast/daily/7day?geocode=${encodeURIComponent(lat)},${encodeURIComponent(lon)}&format=json&language=es-ES&units=m&apiKey=${encodeURIComponent(WEATHER_KEY)}`;
    const data = await getJSON(url);
    if (!data || typeof data !== 'object') {
      setCache(cacheKey, {}, 5 * 60 * 1000);
      return res.json({});
    }
    setCache(cacheKey, data, 30 * 60 * 1000);
    res.json(data);
  } catch (err) {
    console.error('❌ /api/forecast:', err.message);
    res.status(502).json({ error: 'Forecast unavailable', detail: err.message });
  }
});

// ---------- Fallback ----------
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor escuchando en puerto ${PORT}`));