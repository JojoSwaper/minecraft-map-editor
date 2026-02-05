const { app, BrowserWindow, shell } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const HOST = "127.0.0.1";
let server;
let mainWindow;

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html";
    case ".js":
      return "text/javascript";
    case ".css":
      return "text/css";
    case ".json":
      return "application/json";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function startStaticServer() {
  const basePath = app.getAppPath();

  server = http.createServer((req, res) => {
    const requestPath = decodeURIComponent(req.url.split("?")[0]);
    const safePath = requestPath === "/" ? "/index.html" : requestPath;
    const filePath = path.resolve(basePath, `.${safePath}`);

    if (!filePath.startsWith(basePath)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      res.writeHead(200, { "Content-Type": getMimeType(filePath) });
      res.end(data);
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, () => {
      const { port } = server.address();
      resolve(port);
    });
  });
}

async function createWindow() {
  const port = await startStaticServer();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0b0d12",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(`http://${HOST}:${port}`);
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (server) {
    server.close();
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});
