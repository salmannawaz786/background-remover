# Background Remover

AI-powered background removal tool with smart model routing for persons and objects.

## Features

- **Smart Model Selection**: Automatically detects persons vs objects
  - **RVM (Robust Video Matting)**: Fast, high-quality removal for people
  - **RMBG-1.4**: Universal background removal for objects
- **Dual Processing**: Client-side (browser) + Server-side fallback
- **Authentication**: Firebase-based user management
- **Cloud Storage**: Cloudflare R2 integration
- **PWA Support**: Install as desktop/mobile app

## Tech Stack

- **Backend**: Flask, Python 3.11+
- **AI Models**: ONNX Runtime (RVM, RMBG-1.4)
- **Face Detection**: OpenCV
- **Frontend**: Vanilla JS, HTML5, CSS3
- **Storage**: Cloudflare R2
- **Auth**: Firebase Authentication

## Quick Start

### Prerequisites

- Python 3.11+
- Firebase project (for authentication)
- Cloudflare R2 account (for image storage)

### Installation

```bash
# Clone repository
git clone https://github.com/Johny111ishxb/background-remover.git
cd background-remover

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Setup environment variables
cp .env.example .env
# Edit .env with your credentials

# Add Firebase credentials
# Download firebase-credentials.json from Firebase Console
# Place it in the project root

# Run server
python server.py
```

Visit `http://localhost:5001`

## Configuration

### Environment Variables

Create a `.env` file with:

```env
SECRET_KEY=your-secret-key
FIREBASE_CREDENTIALS_PATH=firebase-credentials.json
R2_ENDPOINT=https://your-account.r2.cloudflarestorage.com
R2_ACCESS_KEY=your-r2-access-key
R2_SECRET_KEY=your-r2-secret-key
R2_BUCKET_NAME=your-bucket-name
```

### Firebase Setup

1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com)
2. Enable Authentication → Email/Password
3. Download service account credentials
4. Save as `firebase-credentials.json` in project root

### Cloudflare R2 Setup

1. Create R2 bucket at [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Generate API tokens
3. Add credentials to `.env`

## Models

Models are automatically downloaded on first run:

- **RVM**: 15MB (persons)
- **RMBG-1.4**: 44MB (objects)

## API Endpoints

### `POST /upload`
Upload and process image

**Parameters:**
- `image_file`: Image file (PNG, JPG, JPEG, GIF, WEBP)
- `model`: `fast` or `pro` (default: `fast`)

**Response:**
```json
{
  "success": true,
  "image_url": "https://..."
}
```

### `GET /health`
Server health check

## Performance

- **Face Detection**: <100ms
- **RVM Processing**: 2-5s (persons)
- **RMBG Processing**: 7-10s (objects)
- **Concurrent Requests**: 2 simultaneous

## Security

- ✅ CORS restricted to allowed origins
- ✅ Security headers (CSP, HSTS, X-Frame-Options)
- ✅ Rate limiting for non-authenticated users
- ✅ Input validation and sanitization
- ✅ Environment-based secrets

## License

MIT License - See LICENSE file for details

## Contributing

Contributions welcome! Please open an issue or submit a pull request.

## Support

For issues and questions, please open a GitHub issue.

---

**Made with ❤️ by SalluLabs**
