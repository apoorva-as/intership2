import { useState } from "react";

export default function App() {
  const [objectName, setObjectName] = useState("");
  const [images, setImages] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSearch = async () => {
    if (!objectName.trim()) return;

    setLoading(true);
    setError("");
    setImages(null);

    try {
      const res = await fetch(
        `http://localhost:3001/api/search?q=${encodeURIComponent(objectName)}`
      );
      const data = await res.json();
      setImages(data);
    } catch (err) {
      setError("Failed to fetch images. Is the server running?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2>Product View Image Search</h2>

      <input
        type="text"
        placeholder="Enter object name (e.g. milton bottle)"
        value={objectName}
        onChange={(e) => setObjectName(e.target.value)}
      />

      <button onClick={handleSearch} disabled={loading}>
        {loading ? "Searching..." : "Search"}
      </button>

      {error && <p style={{ color: "red" }}>{error}</p>}

      {images && (
        <div>
          {["front", "side", "top", "back"].map((view) => (
            <div key={view}>
              <h4>{view.charAt(0).toUpperCase() + view.slice(1)} View</h4>
              {images[view] ? (
                <img
                  src={images[view]}
                  alt={`${objectName} ${view} view`}
                  width="200"
                />
              ) : (
                <p>No image found</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}