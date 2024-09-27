const express = require("express");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const app = express();
app.use(cors());
app.use(express.json());

// Middleware for error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

//For vercel
app.get("/", (req, res) => res.send("Express on Vercel"));

// Create or update user and return completed tasks
app.post("/api/create-user", async (req, res) => {
  try {
    const userInfo = req.body;
    const user = await prisma.users.upsert({
      where: { sub: userInfo.sub },
      update: userInfo,
      create: userInfo,
    });

    // Fetch completed tasks for the user
    const completedTasks = await prisma.completed.findMany({
      where: { sub: user.sub },
      include: { tasks: true },
      orderBy: { date: "desc" },
    });

    res.status(200).json({
      message: "User upserted successfully",
      userId: user.id,
      completedTasks: completedTasks.length > 0 ? completedTasks : [],
    });
  } catch (error) {
    console.error("Error processing user:", error);
    res
      .status(500)
      .json({ error: "An error occurred while processing the user" });
  }
});

// Get all completed tasks for a user
app.get("/api/completed", async (req, res) => {
  try {
    const { sub } = req.query;
    const completedTasks = await prisma.completed.findMany({
      where: { sub },
      include: { tasks: true },
      orderBy: { date: "desc" },
    });
    res.status(200).json(completedTasks);
  } catch (error) {
    console.error("Error fetching completed tasks:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching completed tasks" });
  }
});

// Get user info along with their completed tasks
app.get("/api/users/withtasks", async (req, res) => {
  try {
    const { sub } = req.query;
    const userWithTasks = await prisma.users.findUnique({
      where: { sub },
      include: {
        completed: {
          include: {
            tasks: true,
          },
        },
      },
    });

    if (!userWithTasks) {
      return res.status(404).json({ error: "User not found" });
    }

    res.status(200).json(userWithTasks);
  } catch (error) {
    console.error("Error fetching user data with tasks:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching user data" });
  }
});

// Add new completed tasks for a user (only for the current day)
app.post("/api/completed", async (req, res) => {
  try {
    const { sub, date, day, tasks } = req.body;
    const targetDate = new Date(date);

    const result = await prisma.$transaction(async (prisma) => {
      // Create the new tasks
      const createdTasks = await prisma.task.createMany({
        data: tasks.map((task) => ({
          from: task.from,
          to: task.to,
          duration: task.duration,
          topic: task.topic,
          description: task.description,
        })),
      });

      // Get the IDs of the created tasks
      const createdTaskIds = await prisma.task.findMany({
        where: {
          OR: tasks.map((task) => ({
            AND: {
              from: task.from,
              to: task.to,
              topic: task.topic,
            },
          })),
        },
        select: { id: true },
      });

      // Check if a completed entry already exists for this day
      const existingCompleted = await prisma.completed.findFirst({
        where: {
          sub,
          date: {
            gte: new Date(targetDate.setHours(0, 0, 0, 0)),
            lt: new Date(targetDate.setHours(23, 59, 59, 999)),
          },
        },
        include: { tasks: true },
      });

      let completed;

      if (existingCompleted) {
        // Update the existing completed entry
        completed = await prisma.completed.update({
          where: { id: existingCompleted.id },
          data: {
            taskIds: {
              push: createdTaskIds.map((task) => task.id),
            },
          },
          include: { tasks: true },
        });
      } else {
        // Create a new completed entry
        completed = await prisma.completed.create({
          data: {
            sub,
            date: new Date(date),
            day,
            taskIds: createdTaskIds.map((task) => task.id),
          },
          include: { tasks: true },
        });
      }

      return completed;
    });

    res.status(201).json(result);
  } catch (error) {
    console.error("Error adding completed tasks:", error);
    res
      .status(500)
      .json({ error: "An error occurred while adding the completed tasks" });
  }
});

// Update a specific task (only for the current day)
app.put("/api/tasks/:taskId(*)", async (req, res) => {
  try {
    const { taskId } = req.params;
    const { from, to, duration, topic, description } = req.body;
    const today = new Date().toISOString().split("T")[0];

    console.log(`Attempting to update task with id: ${taskId}`);

    // Check if the task is for today
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { completed: true },
    });

    if (!task) {
      console.log(`Task with id ${taskId} not found`);
      return res.status(404).json({ error: "Task not found" });
    }

    console.log(`Found task:`, JSON.stringify(task, null, 2));

    // Check if the task was created today
    const taskDate = task.createdAt.toISOString().split("T")[0];
    console.log(`Task creation date: ${taskDate}, Today: ${today}`);

    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: { from, to, duration, topic, description },
    });

    res.status(200).json(updatedTask);
  } catch (error) {
    console.error("Error updating task:", error);
    res
      .status(500)
      .json({ error: "An error occurred while updating the task" });
  }
});

app.delete("/api/tasks/:taskId(*)", async (req, res) => {
  try {
    const { taskId } = req.params;
    const today = new Date().toISOString().split("T")[0];

    console.log(`Attempting to delete task with id: ${taskId}`);

    // Start a transaction to ensure data consistency
    const result = await prisma.$transaction(async (prisma) => {
      // Check if the task exists
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: { completed: true },
      });

      if (!task) {
        console.log(`Task with id ${taskId} not found`);
        return { error: "Task not found" };
      }

      console.log(`Found task:`, JSON.stringify(task, null, 2));

      // Check if the task was created today
      const taskDate = task.createdAt.toISOString().split("T")[0];
      console.log(`Task creation date: ${taskDate}, Today: ${today}`);

      if (taskDate !== today) {
        console.log(`Task creation date does not match current date`);
        return { error: "Can only delete tasks created today" };
      }

      // Delete the task
      await prisma.task.delete({
        where: { id: taskId },
      });

      // Find the completed entry for this task
      const completedEntry = await prisma.completed.findFirst({
        where: { taskIds: { has: taskId } },
        include: { tasks: true },
      });

      if (completedEntry) {
        // Remove the deleted task ID from the taskIds array
        const updatedTaskIds = completedEntry.taskIds.filter(
          (id) => id !== taskId
        );

        if (updatedTaskIds.length === 0) {
          // If there are no more tasks, delete the completed entry
          await prisma.completed.delete({
            where: { id: completedEntry.id },
          });
          console.log(
            `Deleted empty completed entry for ${completedEntry.date}`
          );
        } else {
          // Update the completed entry with the new taskIds array
          await prisma.completed.update({
            where: { id: completedEntry.id },
            data: { taskIds: updatedTaskIds },
          });
          console.log(`Updated completed entry for ${completedEntry.date}`);
        }
      }

      return { message: "Task deleted successfully" };
    });

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    console.log(`Task ${taskId} deleted successfully`);
    res.status(200).json(result);
  } catch (error) {
    console.error("Error deleting task:", error);
    res
      .status(500)
      .json({ error: "An error occurred while deleting the task" });
  }
});

const port = process.env.PORT || 3001;

async function startServer() {
  try {
    await prisma.$connect();
    console.log("Connected to the database");
    app.listen(port, () => console.log(`Server running on port ${port}`));
  } catch (error) {
    console.error("Failed to connect to the database:", error);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

module.exports = app;