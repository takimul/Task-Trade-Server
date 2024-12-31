const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://task-trade-77fc5.web.app",
      "https://task-trade-77fc5.firebaseapp.com",
    ],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return res
      .status(401)
      .json({ message: "Access denied. No token provided." });
  }

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: "Unauthorized access." });
    }

    req.user = decoded;
    next();
  });
};

// MongoDB Connection
const uri = process.env.DATABASE_URL;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const dbName = "TaskTradeDB";
const servicesCollection = client.db(dbName).collection("services");
const usersCollection = client.db(dbName).collection("users");
const bookingsCollection = client.db(dbName).collection("bookings");

// Main server logic
async function run() {
  try {
    // await client.connect();
    // console.log("Connected to MongoDB successfully!");

    // Authentication APIs
    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    app.post("/logout", (req, res) => {
      res.clearCookie("token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      });
      res.send({ success: true });
    });

    // Service-related APIs
    app.post("/services", async (req, res) => {
      try {
        const service = req.body;
        const { name, imageUrl, price, area, description, providerEmail } =
          service;

        if (
          !name ||
          !imageUrl ||
          !price ||
          !area ||
          !description ||
          !providerEmail
        ) {
          return res.status(400).json({ message: "All fields are required." });
        }

        const result = await servicesCollection.insertOne(service);
        res.status(201).json({
          message: "Service added successfully.",
          serviceId: result.insertedId,
        });
      } catch (error) {
        console.error("Error adding service:", error);
        res.status(500).json({ message: "Failed to add service." });
      }
    });

    app.get("/services", async (req, res) => {
      try {
        const { providerEmail } = req.query;
        const query = providerEmail ? { providerEmail } : {};
        const services = await servicesCollection.find(query).toArray();

        const enrichedServices = await Promise.all(
          services.map(async (service) => {
            const provider = await usersCollection.findOne({
              email: service.providerEmail,
            });
            return {
              ...service,
              providerName: provider?.name || "Unknown",
              providerImage:
                provider?.image || "https://via.placeholder.com/100",
            };
          })
        );

        res.status(200).json(enrichedServices);
      } catch (error) {
        console.error("Error fetching services:", error);
        res.status(500).json({ message: "Failed to fetch services." });
      }
    });

    app.get("/services/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;

        const service = await servicesCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!service) {
          return res.status(404).json({ message: "Service not found." });
        }

        const provider = await usersCollection.findOne({
          email: service.providerEmail,
        });
        const enrichedService = {
          ...service,
          providerName: provider?.name || "Unknown",
          providerImage: provider?.image || "https://via.placeholder.com/100",
        };

        res.status(200).json(enrichedService);
      } catch (error) {
        console.error("Error fetching service by ID:", error);
        res.status(500).json({ message: "Failed to fetch service." });
      }
    });

    // Update service status for a booking
    app.put("/bookings/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { serviceStatus } = req.body;

        if (!serviceStatus) {
          return res
            .status(400)
            .json({ message: "Service status is required." });
        }

        const updatedBooking = await bookingsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { serviceStatus } }
        );

        if (updatedBooking.modifiedCount === 0) {
          return res
            .status(404)
            .json({ message: "Booking not found or unchanged." });
        }

        res
          .status(200)
          .json({ message: "Booking status updated successfully." });
      } catch (error) {
        console.error("Error updating booking status:", error);
        res.status(500).json({ message: "Failed to update booking status." });
      }
    });

    // Update a service
    app.put("/services/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { name, description, price, area, imageUrl } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid service ID" });
        }

        // Validate required fields
        if (!name || !description || !price) {
          return res.status(400).json({ message: "All fields are required." });
        }

        const updateData = {
          name,
          description,
          price: parseFloat(price),
        };

        if (area) updateData.area = area;
        if (imageUrl) updateData.imageUrl = imageUrl;

        const result = await servicesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        if (result.modifiedCount === 0) {
          return res
            .status(404)
            .json({ message: "Service not found or unchanged." });
        }

        res.status(200).json({ message: "Service updated successfully." });
      } catch (error) {
        console.error("Error updating service:", error);
        res.status(500).json({ message: "Failed to update service." });
      }
    });

    app.delete("/services/:id", async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid service ID" });
        }

        const result = await servicesCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).json({ message: "Service not found" });
        }

        res.status(200).json({ message: "Service deleted successfully" });
      } catch (error) {
        console.error("Error deleting service:", error);
        res.status(500).json({ message: "Failed to delete service" });
      }
    });

    app.post("/bookings", verifyToken, async (req, res) => {
      try {
        const {
          serviceId,
          serviceName,
          serviceImage,
          providerEmail,
          providerName,
          userEmail,
          userName,
          serviceDate,
          specialInstructions,
          price,
        } = req.body;

        // Validate required fields
        if (
          !serviceId ||
          !serviceName ||
          !serviceImage ||
          !providerEmail ||
          !providerName ||
          !userEmail ||
          !userName ||
          !serviceDate ||
          !price
        ) {
          return res.status(400).json({
            message: "Missing required fields.",
          });
        }

        // Create booking
        const booking = {
          serviceId,
          serviceName,
          serviceImage,
          providerEmail,
          providerName,
          userEmail,
          userName,
          serviceDate,
          specialInstructions: specialInstructions || "",
          price,
          serviceStatus: "pending",
          createdAt: new Date(),
        };

        const result = await bookingsCollection.insertOne(booking);
        res.status(201).json({
          message: "Booking created successfully.",
          bookingId: result.insertedId,
        });
      } catch (error) {
        console.error("Error creating booking:", error);
        res.status(500).json({ message: "Failed to create booking." });
      }
    });

    // Get all bookings for a user
    app.get("/bookings", verifyToken, async (req, res) => {
      try {
        const userEmail = req.user.email;

        if (!userEmail) {
          return res.status(400).json({ message: "User email is required." });
        }

        const bookings = await bookingsCollection.find({ userEmail }).toArray();

        const enrichedBookings = await Promise.all(
          bookings.map(async (booking) => {
            const service = await servicesCollection.findOne({
              _id: new ObjectId(booking.serviceId),
            });

            return {
              ...booking,
              serviceDetails: service || { name: "Service not found" },
            };
          })
        );

        res.status(200).json(enrichedBookings);
      } catch (error) {
        console.error("Error fetching bookings:", error);
        res.status(500).json({ message: "Failed to fetch bookings." });
      }
    });

    // MongoDB Connection and collections
    const reviewsCollection = client.db(dbName).collection("reviews");

    // API to submit a review
    app.post("/reviews", async (req, res) => {
      try {
        const { reviewer, rating, content } = req.body;

        // Validate required fields
        if (!reviewer || !rating || !content) {
          return res.status(400).json({ message: "All fields are required." });
        }

        const newReview = {
          reviewer,
          rating,
          content,
          date: new Date(), // Store the current date
        };

        const result = await reviewsCollection.insertOne(newReview);
        res.status(201).json({
          message: "Review submitted successfully.",
          reviewId: result.insertedId,
        });
      } catch (error) {
        console.error("Error submitting review:", error);
        res.status(500).json({ message: "Failed to submit review." });
      }
    });

    // API to get reviews
    app.get("/reviews", async (req, res) => {
      try {
        const reviews = await reviewsCollection.find().toArray();
        res.status(200).json(reviews);
      } catch (error) {
        console.error("Error fetching reviews:", error);
        res.status(500).json({ message: "Failed to fetch reviews." });
      }
    });

    // User-related APIs
    app.post("/users", async (req, res) => {
      try {
        const { name, email, image } = req.body;

        if (!name || !email || !image) {
          return res.status(400).json({ message: "All fields are required." });
        }

        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
          return res.status(200).json({ message: "User already exists." });
        }

        const result = await usersCollection.insertOne({ name, email, image });
        res.status(201).json({
          message: "User added successfully.",
          userId: result.insertedId,
        });
      } catch (error) {
        console.error("Error adding user:", error);
        res.status(500).json({ message: "Failed to add user." });
      }
    });

    console.log("API endpoints are set up.");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
  }
}

// Start Server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

app.get("/", (req, res) => {
  res.send("Server is running");
});

run().catch(console.dir);
