# Product Image Multi-View Search API

A Node.js backend that fetches product images from Google Images (via SerpAPI), selects multiple product angles (front, side, top, back), uploads selected images to Cloudinary, and caches results in MySQL for faster repeated searches.

## Features

- Search any product name, for example: Milton bottle, pen, water bottle
- Auto-detects angle keywords from image metadata
- Returns four views:
  - front
  - side
  - top
  - back
- Uploads images to Cloudinary using folder format: products/<product-name>
- Falls back safely to original URLs if Cloudinary upload fails
- Caches final URLs in MySQL to avoid repeated external calls

## Tech Stack

- Node.js
- Express.js
- MySQL
- Cloudinary
- SerpAPI (HTTP API)

## Project Structure

```text
product-search/
|-- server.js
|-- package.json
|-- package-lock.json
|-- .env
|-- README.md
```

## Setup

### 1. Clone

```bash
git clone https://github.com/YOUR_USERNAME/product-image-search.git
cd product-image-search
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create .env in the product-search folder:

```env
SERPAPI_KEY=your_serpapi_key

CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

DB_PASSWORD=your_mysql_password
```

Notes:

- CLOUDINARY_CLOUD_NAME must not contain spaces.
- DB host, user, database, and port are currently defined in server.js as:
  - host: localhost
  - user: root
  - database: product_images
  - port: 3307

### 4. Create MySQL database and table

Run this SQL:

```sql
CREATE DATABASE product_images;
USE product_images;

CREATE TABLE images (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255),
  front TEXT,
  side TEXT,
  top TEXT,
  back TEXT
);
```

### 5. Run the server

```bash
node server.js
```

Server starts on:

```text
http://localhost:3001
```

## API Usage

### Endpoint

```http
GET /api/search?q=product_name
```

### Example

```text
http://localhost:3001/api/search?q=milton%20bottle
```

### Success response

```json
{
  "front": "https://res.cloudinary.com/...",
  "side": "https://res.cloudinary.com/...",
  "top": "https://res.cloudinary.com/...",
  "back": "https://res.cloudinary.com/..."
}
```

### Error response

```json
{
  "error": "Missing query"
}
```

## How It Works

1. Client sends product query.
2. API checks MySQL cache by product name.
3. If found, cached result is returned immediately.
4. If not found:
   - Fetches image candidates from SerpAPI.
   - Detects/assigns front, side, top, and back views.
   - Uploads each selected image to Cloudinary.
   - Falls back to original URL if any upload fails.
   - Saves final URLs into MySQL.
   - Returns final response.

## Security

- Keep .env out of version control.
- Never commit API keys or DB credentials.
- Rotate keys immediately if leaked.

## Future Improvements

- Better product matching and relevance scoring
- Parallelized upload with timeout/retry controls
- Add pagination and result metadata
- Add rate limiting and request validation
- Dockerize and deploy

## Author

apoorva_as

## Support

If this project helped you, star the repository.
