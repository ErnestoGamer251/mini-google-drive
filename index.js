const express = require('express');
const session = require('express-session');
const passport = require('passport');
const PrismaSessionStore = require('@prisma/session-store').PrismaSessionStore;
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();
const app = express();
require('./passport-config')(passport);

app.use(express.urlencoded({ extended: false }));
app.use(session({
    secret: 'your-secret',
    resave: false,
    saveUninitialized: false,
    store: new PrismaSessionStore(
        prisma,
        {
            checkPeriod: 2 * 60 * 1000,  // 2 minutes
        }
    )
}));
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.post('/login', passport.authenticate('local', {
    successRedirect: '/dashboard',
    failureRedirect: '/login',
    failureFlash: true
}));

app.post('/register', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        await prisma.user.create({
            data: {
                email: req.body.email,
                password: hashedPassword
            }
        });
        res.redirect('/login');
    } catch {
        res.redirect('/register');
    }
});

app.get('/dashboard', (req, res) => {
    res.send('Welcome to your dashboard!');
});

app.listen(3000);


const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(403).send('You need to be logged in to upload files.');
    }

    const folderId = req.body.folderId;
    const file = await prisma.file.create({
        data: {
            name: req.file.filename,
            size: req.file.size,
            url: `/uploads/${req.file.filename}`,
            folderId: parseInt(folderId)
        }
    });

    res.send('File uploaded successfully');
});

app.post('/folders', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(403).send('You need to be logged in.');
    }

    const folder = await prisma.folder.create({
        data: {
            name: req.body.name,
            userId: req.user.id
        }
    });

    res.send('Folder created successfully');
});

app.get('/folders/:id', async (req, res) => {
    const folder = await prisma.folder.findUnique({
        where: { id: parseInt(req.params.id) },
        include: { files: true }
    });
    res.json(folder);
});

app.put('/folders/:id', async (req, res) => {
    const folder = await prisma.folder.update({
        where: { id: parseInt(req.params.id) },
        data: { name: req.body.name }
    });
    res.send('Folder updated successfully');
});

app.delete('/folders/:id', async (req, res) => {
    await prisma.folder.delete({ where: { id: parseInt(req.params.id) } });
    res.send('Folder deleted successfully');
});

app.get('/files/:id', async (req, res) => {
    const file = await prisma.file.findUnique({ where: { id: parseInt(req.params.id) } });
    res.json(file);
});

app.get('/files/:id/download', async (req, res) => {
    const file = await prisma.file.findUnique({ where: { id: parseInt(req.params.id) } });
    res.download(path.join(__dirname, file.url));
});

const cloudinary = require('cloudinary').v2;

cloudinary.config({
    cloud_name: 'your_cloud_name',
    api_key: 'your_api_key',
    api_secret: 'your_api_secret'
});

app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(403).send('You need to be logged in to upload files.');
    }

    const result = await cloudinary.uploader.upload(req.file.path);
    const folderId = req.body.folderId;

    const file = await prisma.file.create({
        data: {
            name: req.file.originalname,
            size: req.file.size,
            url: result.secure_url,
            folderId: parseInt(folderId)
        }
    });

    res.send('File uploaded to Cloudinary successfully');
});

const { v4: uuidv4 } = require('uuid');

app.post('/share', async (req, res) => {
    const { folderId, duration } = req.body;
    const expiresAt = new Date(Date.now() + parseDuration(duration));
    const shareLink = uuidv4();

    await prisma.folder.update({
        where: { id: parseInt(folderId) },
        data: { shareLink, expiresAt }
    });

    res.send(`Share link: https://yourapp.com/share/${shareLink}`);
});

app.get('/share/:shareLink', async (req, res) => {
    const folder = await prisma.folder.findUnique({
        where: { shareLink: req.params.shareLink },
        include: { files: true }
    });

    if (!folder || new Date() > folder.expiresAt) {
        return res.status(404).send('Link expired or folder not found.');
    }

    res.json(folder);
});

function parseDuration(duration) {
    const match = duration.match(/(\d+)([d|h|m])/);
    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
        case 'd': return value * 24 * 60 * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'm': return value * 60 * 1000;
    }
}
