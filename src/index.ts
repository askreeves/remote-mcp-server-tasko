// src/index.ts
var MyMCP = class extends McpAgent {
  static options = { hibernate: true };
  
  constructor() {
    super(...arguments);
    this.server = new McpServer({
      name: "task-management-server",
      version: "1.0.0"
    });
    // Add storage for data
    this.dataStore = new Map();
    this.initialized = false; // Track initialization state
  }
  static {
    __name(this, "MyMCP");
  }

  // Ensure data is loaded before any operation
  async ensureInitialized() {
    if (!this.initialized) {
      await this.loadData();
      this.initialized = true;
    }
  }

  // Helper method to save data to durable storage
  async saveData() {
    try {
      const dataArray = Array.from(this.dataStore.entries());
      await this.ctx.storage.put("data", dataArray);
      console.log(`Saved ${dataArray.length} items to storage`);
    } catch (error) {
      console.error("Failed to save data:", error);
      throw error;
    }
  }

  // Helper method to load data from durable storage
  async loadData() {
    try {
      const stored = await this.ctx.storage.get("data");
      console.log("Loading data from storage:", stored ? "data found" : "no data");
      
      if (stored && Array.isArray(stored)) {
        this.dataStore.clear(); // Clear existing data
        for (const [id, itemData] of stored) {
          this.dataStore.set(id, {
            ...itemData,
            createdAt: new Date(itemData.createdAt),
            updatedAt: new Date(itemData.updatedAt),
            dueDate: itemData.dueDate ? new Date(itemData.dueDate) : null,
          });
        }
        console.log(`Loaded ${this.dataStore.size} items from storage`);
      } else {
        console.log("No existing data found in storage");
      }
    } catch (error) {
      console.error("Failed to load data:", error);
    }
  }

  async init() {
    // Load existing data
    await this.ensureInitialized();

    // Add storage test tool
    this.server.tool(
      "test_storage",
      {},
      async () => {
        await this.ensureInitialized();
        
        // Test write
        await this.ctx.storage.put("test", "hello world");
        
        // Test read
        const result = await this.ctx.storage.get("test");
        
        return {
          content: [{
            type: "text",
            text: `🧪 Storage test: "${result}" (should say "hello world")
📊 Current data in memory: ${this.dataStore.size} items`
          }]
        };
      }
    );

    // Create a new task
    this.server.tool(
      "create_task",
      { 
        title: external_exports.string().min(1),
        description: external_exports.string().optional(),
        priority: external_exports.enum(["low", "medium", "high"]).default("medium"),
        dueDate: external_exports.string().optional()
      },
      async ({ title, description, priority, dueDate }) => {
        await this.ensureInitialized();
        
        const taskId = Date.now().toString();
        const now = new Date();
        
        const task = {
          id: taskId,
          title,
          description: description || "",
          priority,
          status: "pending",
          dueDate: dueDate ? new Date(dueDate) : null,
          createdAt: now,
          updatedAt: now
        };
        
        this.dataStore.set(taskId, task);
        await this.saveData();
        
        return {
          content: [{ 
            type: "text", 
            text: `✅ Task created successfully! 
📝 Title: ${title}
🎯 Priority: ${priority}
⏰ Due: ${dueDate ? new Date(dueDate).toLocaleDateString() : "No due date"}
🆔 ID: ${taskId}` 
          }]
        };
      }
    );

    // List all tasks
    this.server.tool(
      "list_tasks",
      { 
        status: external_exports.enum(["pending", "completed", "all"]).default("all"),
        priority: external_exports.enum(["low", "medium", "high", "all"]).default("all")
      },
      async ({ status, priority }) => {
        await this.ensureInitialized();
        
        let tasks = Array.from(this.dataStore.values());
        
        // Filter by status
        if (status !== "all") {
          tasks = tasks.filter(task => task.status === status);
        }
        
        // Filter by priority
        if (priority !== "all") {
          tasks = tasks.filter(task => task.priority === priority);
        }
        
        // Sort by priority and due date
        tasks.sort((a, b) => {
          const priorityOrder = { high: 3, medium: 2, low: 1 };
          if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
            return priorityOrder[b.priority] - priorityOrder[a.priority];
          }
          if (a.dueDate && b.dueDate) {
            return a.dueDate - b.dueDate;
          }
          return a.createdAt - b.createdAt;
        });
        
        if (tasks.length === 0) {
          return {
            content: [{ 
              type: "text", 
              text: `📋 No tasks found matching your criteria 
🔍 Status filter: ${status}
🎯 Priority filter: ${priority}` 
            }]
          };
        }
        
        const taskList = tasks.map(task => {
          const statusEmoji = task.status === "completed" ? "✅" : "⏳";
          const priorityEmoji = { high: "🔴", medium: "🟡", low: "🟢" }[task.priority];
          const dueDateText = task.dueDate ? `📅 Due: ${task.dueDate.toLocaleDateString()}` : "";
          
          return `${statusEmoji} ${priorityEmoji} [${task.id}] ${task.title}
   ${task.description ? `📝 ${task.description}` : ""}
   ${dueDateText}`;
        }).join("\n\n");
        
        return {
          content: [{ 
            type: "text", 
            text: `📋 Tasks (${tasks.length} found):

${taskList}` 
          }]
        };
      }
    );

    // Update task status
    this.server.tool(
      "update_task_status",
      { 
        taskId: external_exports.string().min(1),
        status: external_exports.enum(["pending", "completed"])
      },
      async ({ taskId, status }) => {
        await this.ensureInitialized();
        
        const task = this.dataStore.get(taskId);
        if (!task) {
          return {
            content: [{ 
              type: "text", 
              text: `❌ Task not found with ID: ${taskId}` 
            }]
          };
        }
        
        task.status = status;
        task.updatedAt = new Date();
        
        this.dataStore.set(taskId, task);
        await this.saveData();
        
        const statusEmoji = status === "completed" ? "🎉" : "🔄";
        
        return {
          content: [{ 
            type: "text", 
            text: `${statusEmoji} Task status updated!
📝 Task: ${task.title}
📊 Status: ${status}
⏰ Updated: ${task.updatedAt.toLocaleString()}` 
          }]
        };
      }
    );

    // Delete a task
    this.server.tool(
      "delete_task",
      { 
        taskId: external_exports.string().min(1)
      },
      async ({ taskId }) => {
        await this.ensureInitialized();
        
        const task = this.dataStore.get(taskId);
        if (!task) {
          return {
            content: [{ 
              type: "text", 
              text: `❌ Task not found with ID: ${taskId}` 
            }]
          };
        }
        
        this.dataStore.delete(taskId);
        await this.saveData();
        
        return {
          content: [{ 
            type: "text", 
            text: `🗑️ Task deleted successfully!
📝 Deleted: ${task.title}
📊 Remaining tasks: ${this.dataStore.size}` 
          }]
        };
      }
    );

    // Get task statistics
    this.server.tool(
      "get_task_stats",
      {},
      async () => {
        await this.ensureInitialized();
        
        const tasks = Array.from(this.dataStore.values());
        const total = tasks.length;
        const completed = tasks.filter(t => t.status === "completed").length;
        const pending = tasks.filter(t => t.status === "pending").length;
        const highPriority = tasks.filter(t => t.priority === "high").length;
        const overdue = tasks.filter(t => 
          t.dueDate && t.dueDate < new Date() && t.status === "pending"
        ).length;
        
        const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
        
        return {
          content: [{ 
            type: "text", 
            text: `📊 Task Statistics:

📋 Total Tasks: ${total}
✅ Completed: ${completed}
⏳ Pending: ${pending}
🔴 High Priority: ${highPriority}
⚠️ Overdue: ${overdue}
📈 Completion Rate: ${completionRate}%` 
          }]
        };
      }
    );
  }
};

var index_default = {
  fetch(request, env2, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return MyMCP.serveSSE("/sse").fetch(request, env2, ctx);
    }
    if (url.pathname === "/mcp") {
      return MyMCP.serve("/mcp").fetch(request, env2, ctx);
    }
    return new Response("Not found", { status: 404 });
  }
};

export {
  MyMCP,
  index_default as default
};