# 🎨 Background Remover App

AI-powered background removal with Firebase authentication and cloud storage.

## ✨ Features

- 🖼️ **High-Quality Background Removal** using AI (u2net model)
- ⚡ **2-3x Faster Processing** with balanced optimization
- 🔐 **Firebase Authentication** (Email/Password + Google OAuth)
- ☁️ **Cloud Storage** (Optional Firebase Storage)
- 🎨 **Theme Toggle** (Light/Dark mode)
- 📱 **Responsive Design**
- 🚀 **Single & Batch Processing**

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure Environment

```bash
# Copy example env file
copy .env.example .env

# Edit .env with your settings
```

### 3. Run the Server

```bash
python server.py
```

### 4. Open Your Browser

```
http://localhost:5000
```

---

## 📋 Requirements

- **Python** 3.8+
- **pip** (Python package manager)
- **Firebase Account** (for authentication)

---

## ⚙️ Configuration

### Environment Variables (.env)

```env
SECRET_KEY=your-secret-key
MAX_WORKERS=8
MODEL_NAME=u2net
FIREBASE_CREDENTIALS_PATH=firebase-credentials.json
FIREBASE_STORAGE_BUCKET=your-project.appspot.com
```

### Performance Tuning

| Setting | Speed | Quality | Use Case |
|---------|-------|---------|----------|
| `MODEL_NAME=u2net` | ⚡⚡ | ⭐⭐⭐⭐⭐ | **Recommended** - Best quality |
| `MODEL_NAME=u2netp` | ⚡⚡⚡⚡⚡ | ⭐⭐⭐⭐ | Maximum speed, good quality |

---

## 🔥 Firebase Setup

### 1. Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create new project
3. Enable Authentication (Email/Password + Google)
4. Enable Firestore Database
5. (Optional) Enable Storage

### 2. Get Credentials

1. Go to Project Settings → Service Accounts
2. Generate new private key
3. Save as `firebase-credentials.json` in project root

### 3. Update firebaseauth.js

Replace the config in `static/firebaseauth.js`:

```javascript
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    // ... rest of config
};
```

---

## 📁 Project Structure

```
background-remover-master/
├── server.py              # Main Flask server
├── templates/
│   ├── index.html        # Main app
│   ├── login.html        # Login page
│   └── signup.html       # Signup page
├── static/
│   ├── app.js            # Main logic
│   ├── scripts.js        # Theme & animations
│   ├── firebaseauth.js   # Authentication
│   └── *.css             # Styles
├── .env                   # Configuration (create from .env.example)
├── requirements.txt       # Python dependencies
└── uploads/               # Temp files (auto-cleanup)
```

---

## 🔐 Authentication

### Sign Up Flow

1. User registers at `/signup`
2. Firebase creates account
3. Verification email sent
4. User verifies email
5. Logs in and gets access

### Login Flow

1. User logs in at `/login`
2. Firebase authenticates
3. Token sent to backend
4. Backend verifies token
5. Session created
6. Access granted

---

## 📊 API Endpoints

### Public Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Main app |
| `/login` | GET | Login page |
| `/signup` | GET | Signup page |
| `/health` | GET | Health check |
| `/upload` | POST | Process image |

### Auth Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/verify-token` | POST | Verify Firebase token |
| `/logout` | GET | Clear session |

---

## 🎨 Theme Toggle

### How to Use

Click the floating button in bottom-right corner to switch between light and dark themes.

### Customization

Edit `static/theme-toggle.css`:

```css
[data-theme="light"] {
    --bg-color: #ffffff;
    --text-color: #333333;
}

[data-theme="dark"] {
    --bg-color: #1a1a1a;
    --text-color: #ffffff;
}
```

---

## 🛠️ Troubleshooting

### App Won't Start

```bash
# Check Python version
python --version  # Should be 3.8+

# Reinstall dependencies
pip install -r requirements.txt --upgrade
```

### Firebase Errors

- Verify `firebase-credentials.json` exists
- Check Firebase config in `firebaseauth.js`
- Ensure Firebase services are enabled

### Slow Processing

- Try `MODEL_NAME=u2netp` in `.env`
- Increase `MAX_WORKERS`
- Check system resources

---

## 📈 Performance

### Current Settings (Balanced)

- **Processing Time**: 2-3 seconds per image
- **Image Quality**: Excellent (95%)
- **Max Resolution**: 1200px (auto-resize)

### Optimization Tips

1. **More CPU Cores**: Increase `MAX_WORKERS`
2. **Faster Model**: Use `u2netp`
3. **Smaller Images**: Users can resize before upload
4. **SSD Storage**: Faster file I/O

---

## 🚀 Deployment

### Local Development

```bash
python server.py
```

### Production (Vercel)

Already configured! Just:

1. Push to GitHub
2. Import to Vercel
3. Add environment variables
4. Deploy!

---

## 📝 License

MIT License - Feel free to use for personal or commercial projects!

---

## 🤝 Support

- **Docs**: Read `SETUP_GUIDE.md`
- **Logs**: Check `app.log`
- **Health**: Visit `/health` endpoint

---

## 🎯 Features Roadmap

- [ ] Image format selection (PNG/JPEG/WebP)
- [ ] Custom background colors
- [ ] Batch processing UI improvements
- [ ] Image history/gallery
- [ ] Advanced editing tools

---

**Made with ❤️ by SalluLabs**

*For detailed setup instructions, see [SETUP_GUIDE.md](SETUP_GUIDE.md)*
