import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
// Chargement des variables d'environnement
dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;
// Pool MySQL
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());
// GET /api/categories : toutes les catégories
app.get('/api/categories', async (_req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM Category');
        res.json(rows);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/products : tous les produits ou par catégorie
app.get('/api/products', async (req, res) => {
    try {
        const { category } = req.query;
        let sql = 'SELECT * FROM Products';
        let params = [];
        if (category) {
            sql += ' WHERE category_id = ?';
            params.push(category);
        }
        const [rows] = await db.query(sql, params);
        res.json(rows);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/products/:id : produit par id
app.get('/api/products/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query('SELECT * FROM Products WHERE id = ?', [id]);
        const products = rows;
        if (products.length === 0) {
            return res.status(404).json({ error: 'Produit non trouvé' });
        }
        res.json(products[0]);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/contact : enregistre un message de contact
app.post('/api/contact', async (req, res) => {
    try {
        const { name, email, subject, message } = req.body;
        if (!name || !email || !subject || !message) {
            return res.status(400).json({ error: 'Tous les champs sont requis.' });
        }
        await db.query('INSERT INTO ContactMessages (name, email, subject, message) VALUES (?, ?, ?, ?)', [name, email, subject, message]);
        res.status(201).json({ message: 'Message enregistré.' });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
