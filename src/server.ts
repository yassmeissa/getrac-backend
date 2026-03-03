import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pg from 'pg'; // Changement : pg au lieu de mysql2
import nodemailer from 'nodemailer';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const paydunya = require('paydunya');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;
const VERCEL_URL = "https://getrac.vercel.app";

// ==========================================
// CONFIGURATION POSTGRESQL (POOL)
// ==========================================
const { Pool } = pg;
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Obligatoire pour la connexion sécurisée Render
  }
});

// ==========================================
// CONFIGURATION PAYDUNYA
// ==========================================
const paydunyaSetup = new paydunya.Setup({
  masterKey: process.env.PAYDUNYA_MASTER_KEY,
  privateKey: process.env.PAYDUNYA_PRIVATE_KEY,
  publicKey: process.env.PAYDUNYA_PUBLIC_KEY,
  token: process.env.PAYDUNYA_TOKEN,
  mode: "test" 
});

const paydunyaStore = new paydunya.Store({
  name: "Getrac",
  tagline: "Vente de services et matériels",
  postalAddress: "Dakar, Sénégal",
  phoneNumber: "77 000 00 00",
  websiteUrl: VERCEL_URL,
  cancelUrl: `${VERCEL_URL}/cart`,
  returnUrl: `${VERCEL_URL}/success`
});

// Middlewares
app.use(cors({
  origin: [VERCEL_URL, 'http://localhost:5173'], // Autorise Vercel et le local pour les tests
  credentials: true
}));
app.use(express.json());

// ==========================================
// ROUTES CATALOGUE (ADAPTÉES POSTGRES)
// ==========================================

// GET /api/categories
// GET /api/categories
app.get('/api/categories', async (_req: Request, res: Response) => {
  try {
    // Essayez en minuscules sans guillemets
    const result = await db.query('SELECT * FROM category'); 
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products
app.get('/api/products', async (req: Request, res: Response) => {
  try {
    const { category } = req.query;
    // Idem ici : "products" au lieu de "Products"
    let sql = 'SELECT * FROM products'; 
    let params: any[] = [];
    
    if (category) {
      // Vérifiez aussi le nom de la colonne (probablement category_id)
      sql += ' WHERE category_id = $1'; 
      params.push(category);
    }
    
    const result = await db.query(sql, params);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/:id
app.get('/api/products/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM products WHERE idproduct = $1', [id]);     
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produit non trouvé' });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ROUTE DE PAIEMENT
// ==========================================
app.post('/api/create-payment', async (req: Request, res: Response) => {
  try {
    const { items, total, orderId } = req.body;
    const invoice = new paydunya.CheckoutInvoice(paydunyaSetup, paydunyaStore);

    items.forEach((item: any) => {
      const price = Number(String(item.price).replace(/[^\d.]/g, ''));
      invoice.addItem(item.name || "Article Getrac", item.quantity, price, price * item.quantity);
    });

    invoice.totalAmount = total;
    invoice.description = `Commande ${orderId} chez Getrac`;

    await invoice.create();
    res.status(200).json({ success: true, url: invoice.url });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// ==========================================
// ROUTE CONTACT (EMAIL AVEC VERT #115E59)
// ==========================================
app.post('/api/contact', async (req: Request, res: Response) => {
  try {
    const { userType, lastName, firstName, email, phone, subject, message } = req.body;

    if (!userType || !lastName || !firstName || !email || !subject || !message) {
      return res.status(400).json({ error: 'Champs manquants.' });
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false, 
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    const emailStyle = `font-family: sans-serif; color: #333; max-width: 600px; border: 1px solid #eee; padding: 20px;`;
    const headerStyle = `color: #115E59;`; // Nouveau vert appliqué ici

    const clientMailOptions = {
      from: 'servicesgetrac@gmail.com',
      to: email,
      subject: `Confirmation de votre demande - Getrac`,
      html: `
        <div style="${emailStyle}">
            <h2 style="${headerStyle}">Bonjour ${firstName} ${lastName},</h2>
            <p>Nous avons bien reçu votre demande concernant : <strong>${subject}</strong>.</p>
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <ul style='list-style: none; padding: 0;'>
                  <li><strong>Profil :</strong> ${userType}</li>
                  <li><strong>Téléphone :</strong> ${phone || 'N/A'}</li>
                  <li><strong>Message :</strong><br/> <i>${message.replace(/\n/g, '<br>')}</i></li>
              </ul>
            </div>
            <p>Cordialement,<br><strong>L'équipe de Getrac Services</strong></p>
        </div>`
    };

    await transporter.sendMail(clientMailOptions);
    res.status(200).json({ success: true, message: 'Email envoyé !' });

  } catch (err: any) {
    res.status(500).json({ success: false, error: "Erreur service email." });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (PostgreSQL mode)`);
});