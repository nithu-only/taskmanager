// Portable Task Manager launcher.
//
// This executable contains a zip payload (the Next.js standalone server, the
// PowerShell helper scripts and a private copy of node.exe). On first launch it
// extracts the payload under %LOCALAPPDATA%\TaskManagerPortable, starts the
// local server on a free loopback port and opens the UI in the default browser.
// A tray icon keeps the server alive; "Exit" stops it and its child processes.

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

static class Program
{
    private const string AppTitle = "Task Manager";
    private const string MutexName = "Local\\TaskManagerPortable-7B2C1D0A";
    private const string StopEventName = "Local\\TaskManagerPortable-Stop-7B2C1D0A";

    private static Process node;
    private static NotifyIcon tray;
    private static System.Windows.Forms.Timer watchdog;
    private static Mutex mutex;
    private static string dataDir;
    private static string appDir;
    private static string logPath;
    private static string baseUrl;
    private static int port;
    private static bool exiting;
    private static volatile bool stopRequested;
    private static EventWaitHandle stopEvent;

    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        dataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "TaskManagerPortable");
        Directory.CreateDirectory(dataDir);
        logPath = Path.Combine(dataDir, "server.log");

        if (HasArg(args, "--stop"))
        {
            RequestStop();
            return;
        }

        bool created;
        mutex = new Mutex(true, MutexName, out created);
        if (!created)
        {
            // Already running: just bring up the UI that is already serving.
            OpenRunningInstance();
            return;
        }

        try
        {
            string version = ReadResourceText("app.version").Trim();
            appDir = Path.Combine(dataDir, "app-" + version);
            ExtractPayload(version);

            bool stopCreated;
            stopEvent = new EventWaitHandle(false, EventResetMode.AutoReset, StopEventName, out stopCreated);
            Thread stopThread = new Thread(WatchForStop);
            stopThread.IsBackground = true;
            stopThread.Start();

            port = FindFreePort();
            baseUrl = "http://127.0.0.1:" + port + "/";

            if (!StartServer())
            {
                ShowError("The Task Manager server could not be started.\n\nLog: " + logPath);
                Shutdown();
                return;
            }

            File.WriteAllText(Path.Combine(dataDir, "port.txt"), port.ToString());

            if (!WaitForHealth(60000))
            {
                ShowError("The Task Manager server did not respond in time.\n\nLog: " + logPath);
                Shutdown();
                return;
            }

            CreateTray();
            OpenBrowser();

            watchdog = new System.Windows.Forms.Timer();
            watchdog.Interval = 2000;
            watchdog.Tick += delegate
            {
                if (exiting)
                {
                    return;
                }
                if (stopRequested)
                {
                    Quit();
                    return;
                }
                if (node != null && node.HasExited)
                {
                    exiting = true;
                    tray.ShowBalloonTip(4000, AppTitle, "The local server stopped. See server.log for details.",
                        ToolTipIcon.Error);
                    Quit();
                }
            };
            watchdog.Start();

            Application.Run();
        }
        catch (Exception ex)
        {
            ShowError("Task Manager could not start.\n\n" + ex.Message);
            Shutdown();
        }
    }

    // ---------------------------------------------------------------- payload

    private static string ReadResourceText(string name)
    {
        using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
        {
            if (stream == null)
            {
                throw new Exception("Missing embedded resource: " + name);
            }
            using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
            {
                return reader.ReadToEnd();
            }
        }
    }

    private static void ExtractPayload(string version)
    {
        string marker = Path.Combine(appDir, ".payload-complete");
        if (File.Exists(marker))
        {
            return;
        }

        if (Directory.Exists(appDir))
        {
            TryDeleteDirectory(appDir);
        }
        Directory.CreateDirectory(appDir);

        string zipPath = Path.Combine(dataDir, "payload-" + version + ".zip");
        using (Stream embedded = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
        {
            if (embedded == null)
            {
                throw new Exception("The application payload is missing from this executable.");
            }
            using (FileStream file = File.Create(zipPath))
            {
                embedded.CopyTo(file);
            }
        }

        try
        {
            ZipFile.ExtractToDirectory(zipPath, appDir);
        }
        finally
        {
            try { File.Delete(zipPath); } catch { }
        }

        File.WriteAllText(marker, version);
        CleanupOldVersions();
    }

    private static void CleanupOldVersions()
    {
        try
        {
            foreach (string oldDir in Directory.GetDirectories(dataDir, "app-*"))
            {
                if (string.Equals(oldDir, appDir, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                TryDeleteDirectory(oldDir);
            }
        }
        catch
        {
            // Stale versions are harmless; try again on the next launch.
        }
    }

    private static void TryDeleteDirectory(string path)
    {
        try
        {
            Directory.Delete(path, true);
        }
        catch (Exception)
        {
            // A leftover file may be locked. Force-delete with a retry next start.
            Thread.Sleep(300);
            try { Directory.Delete(path, true); } catch { }
        }
    }

    // ----------------------------------------------------------------- server

    private static bool StartServer()
    {
        string nodePath = Path.Combine(appDir, "node.exe");
        if (!File.Exists(nodePath))
        {
            File.AppendAllText(logPath, "node.exe not found in " + appDir + Environment.NewLine);
            return false;
        }

        try { File.WriteAllText(logPath, ""); } catch { }

        ProcessStartInfo info = new ProcessStartInfo();
        info.FileName = nodePath;
        info.Arguments = "server.js";
        info.WorkingDirectory = appDir;
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;
        info.StandardOutputEncoding = Encoding.UTF8;
        info.StandardErrorEncoding = Encoding.UTF8;
        info.EnvironmentVariables["PORT"] = port.ToString();
        info.EnvironmentVariables["HOSTNAME"] = "127.0.0.1";
        info.EnvironmentVariables["NODE_ENV"] = "production";

        node = new Process();
        node.StartInfo = info;
        node.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { LogLine(e.Data); };
        node.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { LogLine(e.Data); };
        node.Start();
        node.BeginOutputReadLine();
        node.BeginErrorReadLine();
        return true;
    }

    private static object logLock = new object();

    private static void LogLine(string line)
    {
        if (line == null)
        {
            return;
        }
        try
        {
            lock (logLock)
            {
                File.AppendAllText(logPath, line + Environment.NewLine);
            }
        }
        catch { }
    }

    private static bool WaitForHealth(int timeoutMs)
    {
        DateTime deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            if (node.HasExited)
            {
                return false;
            }
            if (IsHealthy())
            {
                return true;
            }
            Thread.Sleep(400);
        }
        return false;
    }

    private static bool IsHealthy()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(baseUrl + "api/health");
            request.Timeout = 1500;
            request.Proxy = null;
            request.AllowAutoRedirect = false;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            {
                return (int)response.StatusCode >= 200 && (int)response.StatusCode < 400;
            }
        }
        catch
        {
            return false;
        }
    }

    private static int FindFreePort()
    {
        TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        int chosen = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return chosen;
    }

    private static void OpenBrowser()
    {
        try
        {
            Process.Start(baseUrl);
        }
        catch (Exception ex)
        {
            ShowError("Open this address in your browser:\n\n" + baseUrl + "\n\n" + ex.Message);
        }
    }

    private static void OpenRunningInstance()
    {
        string portFile = Path.Combine(dataDir, "port.txt");
        for (int attempt = 0; attempt < 15; attempt++)
        {
            try
            {
                if (File.Exists(portFile))
                {
                    string url = "http://127.0.0.1:" + File.ReadAllText(portFile).Trim() + "/";
                    HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url + "api/health");
                    request.Timeout = 1000;
                    request.Proxy = null;
                    using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                    {
                        Process.Start(url);
                        return;
                    }
                }
            }
            catch { }
            Thread.Sleep(400);
        }
        ShowError("Task Manager is already running, but its address could not be found.\n\n" +
                  "Look for the tray icon next to the clock.");
    }

    // ------------------------------------------------------------------- tray

    private static void CreateTray()
    {
        ContextMenuStrip menu = new ContextMenuStrip();
        menu.Items.Add("Open Task Manager", null, delegate { OpenBrowser(); });
        menu.Items.Add("Show server log", null, delegate
        {
            try { Process.Start(logPath); } catch { }
        });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, delegate { Quit(); });

        tray = new NotifyIcon();
        tray.Icon = SystemIcons.Application;
        tray.Text = AppTitle;
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += delegate { OpenBrowser(); };
        tray.Visible = true;
        tray.ShowBalloonTip(3000, AppTitle,
            "Running at " + baseUrl + " - right-click the tray icon to exit.", ToolTipIcon.Info);
    }

    private static void Quit()
    {
        exiting = true;
        if (watchdog != null)
        {
            watchdog.Stop();
        }
        Shutdown();
        Application.Exit();
    }

    private static bool cleanedUp;

    private static void Shutdown()
    {
        if (cleanedUp)
        {
            return;
        }
        cleanedUp = true;

        if (tray != null)
        {
            tray.Visible = false;
            tray.Dispose();
            tray = null;
        }

        KillServerTree();

        try { File.Delete(Path.Combine(dataDir, "port.txt")); } catch { }

        if (mutex != null)
        {
            try { mutex.ReleaseMutex(); } catch { }
            mutex.Dispose();
            mutex = null;
        }

        if (stopEvent != null)
        {
            try { stopEvent.Close(); } catch { }
            stopEvent = null;
        }
    }

    private static void KillServerTree()
    {
        if (node == null)
        {
            return;
        }
        try
        {
            if (!node.HasExited)
            {
                ProcessStartInfo info = new ProcessStartInfo("taskkill",
                    "/PID " + node.Id + " /T /F");
                info.UseShellExecute = false;
                info.CreateNoWindow = true;
                info.RedirectStandardOutput = true;
                info.RedirectStandardError = true;
                using (Process killer = Process.Start(info))
                {
                    killer.WaitForExit(8000);
                }
            }
        }
        catch { }
        finally
        {
            try { node.Dispose(); } catch { }
            node = null;
        }
    }

    private static void ShowError(string message)
    {
        MessageBox.Show(message, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    // ------------------------------------------------------------- stop signal

    private static bool HasArg(string[] args, string name)
    {
        if (args == null)
        {
            return false;
        }
        foreach (string arg in args)
        {
            if (string.Equals(arg, name, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }
        return false;
    }

    private static void WatchForStop()
    {
        try
        {
            while (true)
            {
                stopEvent.WaitOne();
                stopRequested = true;
            }
        }
        catch
        {
            // The handle is disposed while the process shuts down.
        }
    }

    private static void RequestStop()
    {
        try
        {
            using (EventWaitHandle handle = EventWaitHandle.OpenExisting(StopEventName))
            {
                handle.Set();
            }
            // Give the running instance a moment to shut down cleanly.
            Thread.Sleep(1500);
        }
        catch (WaitHandleCannotBeOpenedException)
        {
            // Not running, nothing to stop.
        }
        catch (Exception)
        {
            // Stop signals are best effort; the tray menu always works.
        }
    }
}
