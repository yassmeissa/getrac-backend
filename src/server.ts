import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import nodemailer from 'nodemailer';
// --- ASTUCE POUR LES MODULES ES ---
// On recrée la fonction require() pour pouvoir importer les vieux packages
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const paydunya = require('paydunya');
// ----------------------------------

// Chargement des variables d'environnement
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

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

// 1. Initialisation de PayDunya avec tes clés du fichier .env
const paydunyaSetup = new paydunya.Setup({
  masterKey: process.env.PAYDUNYA_MASTER_KEY,
  privateKey: process.env.PAYDUNYA_PRIVATE_KEY,
  publicKey: process.env.PAYDUNYA_PUBLIC_KEY, // N'oublie pas d'ajouter ça dans ton .env !
  token: process.env.PAYDUNYA_TOKEN,
  mode: "test" // "test" ou "live"
});

// 2. Configuration de la boutique (attention à la syntaxe camelCase)
const paydunyaStore = new paydunya.Store({
  name: "Getrac",
  tagline: "Vente de services et matériels",
  postalAddress: "Dakar, Sénégal",
  phoneNumber: "77 000 00 00",
  websiteUrl: "https://getracservices.com",
  cancelUrl: "http://localhost:5173/cart",
  returnUrl: "http://localhost:5173/success"
});

// Middlewares
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use((req, res, next) => {
  console.log('Requête reçue:', req.method, req.url);
  next();
});



// ==========================================
// ROUTES DU CATALOGUE ET CONTACT
// ==========================================

// GET /api/categories : toutes les catégories
app.get('/api/categories', async (_req: Request, res: Response) => {
  console.log('GET /api/categories called');
  try {
    const [rows] = await db.query('SELECT * FROM Category');
    res.json(rows);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products : tous les produits ou par catégorie
app.get('/api/products', async (req: Request, res: Response) => {
  try {
    const { category } = req.query;
    let sql = 'SELECT * FROM Products';
    let params: any[] = [];
    if (category) {
      sql += ' WHERE category_id = ?';
      params.push(category);
    }
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/:id : produit par id
app.get('/api/products/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query('SELECT * FROM Products WHERE idProduct = ?', [id]);
    const products = rows as any[];
    if (products.length === 0) {
      return res.status(404).json({ error: 'Produit non trouvé' });
    }
    res.json(products[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});



// ==========================================
// ROUTE DE PAIEMENT PAYDUNYA
// ==========================================

// POST /api/create-payment : Crée la facture et génère le lien Wave / OM / CB
app.post('/api/create-payment', async (req: Request, res: Response) => {
  try {
    const { items, total, orderId } = req.body;
    
    // On passe l'objet Setup et Store à la nouvelle facture
    const invoice = new paydunya.CheckoutInvoice(paydunyaSetup, paydunyaStore);

    // Ajout des articles
    items.forEach((item: any) => {
      // Nettoyage du prix pour s'assurer d'avoir un format numérique valide
      const price = Number(String(item.price).replace(/[^\d.]/g, ''));
      const itemName = item.name || "Article Getrac";
      
      invoice.addItem(itemName, item.quantity, price, price * item.quantity);
    });

    // Configuration du total et de la description
    invoice.totalAmount = total;
    invoice.description = `Commande ${orderId} chez Getrac`;

    // Création de la facture chez PayDunya
    await invoice.create();

    // Renvoi de l'URL sécurisée générée vers React
    res.status(200).json({
      success: true,
      url: invoice.url
    });
  } catch (error) {
    console.error("Erreur de création de facture PayDunya:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la création du paiement avec PayDunya."
    });
  }
});



// POST /api/contact : Envoie uniquement un email via Brevo (sans stockage BDD)
app.post('/api/contact', async (req: Request, res: Response) => {
  console.log('Contact form received:', req.body);
  try {
    const { userType, lastName, firstName, email, phone, subject, message } = req.body;

    // Validation rapide
    if (!userType || !lastName || !firstName || !email || !subject || !message) {
      return res.status(400).json({ error: 'Les champs obligatoires sont manquants.' });
    }

    // 1. Configuration de Nodemailer
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false, 
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    // 2. Préparation du mail de confirmation pour le client
    const clientMailOptions = {
      from: 'servicesgetrac@gmail.com',
      to: email,
      subject: `Confirmation de votre demande de contact - Getrac`,
      html: `
        <div style="font-family: sans-serif; color: #333; max-width: 600px; border: 1px solid #eee; padding: 20px;">
            <h2 style='color: #054d3b;'>Bonjour ${firstName} ${lastName},</h2>
            <p>Nous avons bien reçu votre demande de contact concernant l'objet suivant : <strong>${subject}</strong>.</p>
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; font-size: 16px;">Récapitulatif de votre message :</h3>
              <ul style='list-style: none; padding: 0;'>
                  <li style="margin-bottom: 8px;"><strong>Profil :</strong> ${userType}</li>
                  <li style="margin-bottom: 8px;"><strong>Téléphone :</strong> ${phone || 'N/A'}</li>
                  <li style="margin-bottom: 8px;"><strong>Message :</strong><br/> 
                      <i style="color: #555;">${message.replace(/\n/g, '<br>')}</i>
                  </li>
              </ul>
            </div>
            <p>Notre équipe traitera votre demande dans les plus brefs délais.</p>
            <p>Cordialement,<br><strong>L'équipe de Getrac Services</strong></p>

        </div>
      `
    };

    // 3. Préparation du mail de notification pour l'admin
    const adminMailOptions = {
      from: 'servicesgetrac@gmail.com',
      to: 'servicesgetrac@gmail.com',
      subject: `[Contact Getrac] Nouvelle demande de ${firstName} ${lastName}`,
      html: `
        <div style="font-family: sans-serif; color: #333; max-width: 600px; border: 1px solid #eee; padding: 20px;">
            <h2 style='color: #054d3b;'>Nouvelle demande de contact reçue</h2>
            <ul style='list-style: none; padding: 0;'>
                <li><strong>Nom :</strong> ${lastName}</li>
                <li><strong>Prénom :</strong> ${firstName}</li>
                <li><strong>Email :</strong> ${email}</li>
                <li><strong>Téléphone :</strong> ${phone || 'N/A'}</li>
                <li><strong>Profil :</strong> ${userType}</li>
                <li><strong>Objet :</strong> ${subject}</li>
                <li><strong>Message :</strong><br/> <i style="color: #555;">${message.replace(/\n/g, '<br>')}</i></li>
            </ul>
            <div style="text-align:center; margin-top:30px;">
              <img src="http://localhost:5001/logo-getrac.png" alt="Logo Getrac" style="max-width:180px; width:60%; height:auto;"/>
            </div>
        </div>
      `
    };

    // 4. Envoi des deux emails (client puis admin)
    await transporter.sendMail(clientMailOptions);
    await transporter.sendMail(adminMailOptions);

    // 5. Réponse positive au Frontend
    res.status(200).json({ 
      success: true, 
      message: 'Email envoyé avec succès !' 
    });

  } catch (err: any) {
    console.error("Erreur d'envoi d'email :", err);
    if (err && err.response) {
      console.error('Nodemailer response:', err.response);
    }
    if (err && err.stack) {
      console.error('Stack trace:', err.stack);
    }
    res.status(500).json({ 
      success: false, 
      error: "Le service d'envoi d'emails est temporairement indisponible." 
    });
  }
});

// Lancement du serveur
console.log('API setup done, ready to listen...');
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});