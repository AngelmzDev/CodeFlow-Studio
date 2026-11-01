using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace CodeFlowStudio.Desktop
{
    internal static class Program
    {
        private const string AppVersion = "0.2.0";

        [STAThread]
        private static int Main(string[] args)
        {
            if (args.Length > 0 && String.Equals(args[0], "--self-test", StringComparison.OrdinalIgnoreCase))
            {
                if (args.Length < 2 || String.IsNullOrWhiteSpace(args[1]))
                {
                    Console.Error.WriteLine("Usage: Launcher.exe --self-test DIAGNOSTICS_PATH");
                    return 2;
                }
                return LauncherForm.RunSelfTest(args[1]);
            }

            bool createdNew;
            MutexHolder mutex = null;
            try
            {
                mutex = new MutexHolder("Local\\CodeFlowStudio.Desktop." + AppVersion, out createdNew);
                if (!createdNew)
                {
                    MessageBox.Show("CodeFlow Studio ya está abierto.", "CodeFlow Studio", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return 0;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new LauncherForm());
                return 0;
            }
            catch (Exception error)
            {
                LauncherForm.WriteLog("Launcher failed", error);
                MessageBox.Show("No se pudo iniciar CodeFlow Studio.\r\n\r\n" + error.Message,
                    "CodeFlow Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            finally
            {
                if (mutex != null) mutex.Dispose();
            }
        }
    }

    internal sealed class MutexHolder : IDisposable
    {
        private readonly Mutex _mutex;
        public MutexHolder(string name, out bool createdNew) { _mutex = new Mutex(true, name, out createdNew); }
        public void Dispose()
        {
            try { _mutex.ReleaseMutex(); }
            catch (ApplicationException) { }
            _mutex.Dispose();
        }
    }

    internal sealed class LauncherForm : Form
    {
        // Release packaging replaces this marker with the first 16 hex characters of payload.zip SHA-256.
        private const string PayloadId = "__PAYLOAD_ID__";
        private const string ReadyPrefix = "CodeFlow Studio: ";
        private readonly Label _status;
        private readonly Button _open;
        private readonly Button _close;
        private readonly TaskCompletionSource<string> _url = new TaskCompletionSource<string>();
        private readonly TaskCompletionSource<bool> _exited = new TaskCompletionSource<bool>();
        private readonly object _outputLock = new object();
        private readonly StringBuilder _stdout = new StringBuilder();
        private readonly StringBuilder _stderr = new StringBuilder();
        private NativeJob _job;
        private Process _backend;
        private string _serverUrl;
        private volatile bool _closing;
        private int _browserOpened;

        public LauncherForm()
        {
            Text = "CodeFlow Studio";
            Width = 440;
            Height = 190;
            MinimumSize = new System.Drawing.Size(440, 190);
            MaximumSize = new System.Drawing.Size(440, 190);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = true;

            _status = new Label();
            _status.AutoSize = false;
            _status.Left = 24;
            _status.Top = 22;
            _status.Width = 380;
            _status.Height = 52;
            _status.Text = "Iniciando CodeFlow Studio…";
            _status.Font = new System.Drawing.Font("Segoe UI", 10F, System.Drawing.FontStyle.Regular);

            _open = new Button();
            _open.Left = 24;
            _open.Top = 92;
            _open.Width = 210;
            _open.Height = 36;
            _open.Text = "Abrir CodeFlow";
            _open.Enabled = false;
            _open.Click += OpenClicked;

            _close = new Button();
            _close.Left = 250;
            _close.Top = 92;
            _close.Width = 154;
            _close.Height = 36;
            _close.Text = "Cerrar";
            _close.Click += CloseClicked;

            Controls.Add(_status);
            Controls.Add(_open);
            Controls.Add(_close);
            Shown += FormShown;
            FormClosing += FormIsClosing;
        }

        private async void FormShown(object sender, EventArgs args)
        {
            try
            {
                string root = await Task.Run<string>(delegate { return ExtractPayload(delegate { return _closing; }); });
                if (_closing) return;
                StartBackend(root);
                Task completed = await Task.WhenAny(_url.Task, _exited.Task, Task.Delay(30000));
                if (_closing) return;
                if (completed != _url.Task)
                {
                    string diagnostics = GetDiagnostics();
                    if (completed == _exited.Task)
                        throw new InvalidOperationException("El servidor terminó antes de estar listo.\r\n" + diagnostics);
                    throw new TimeoutException("El servidor no respondió a tiempo.\r\n" + diagnostics);
                }
                _serverUrl = await _url.Task;
                if (_closing) return;
                _status.Text = "CodeFlow Studio está listo. Puedes volver a abrirlo desde aquí.";
                _open.Enabled = true;
                OpenBrowser();
            }
            catch (Exception error)
            {
                if (_closing) return;
                StopBackend();
                WriteLog("Startup failed", error);
                _status.Text = "No se pudo iniciar CodeFlow Studio. Consulta el registro local.";
                _open.Enabled = false;
                MessageBox.Show(this, "No se pudo iniciar CodeFlow Studio.\r\n\r\n" + error.Message,
                    "CodeFlow Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void StartBackend(string root)
        {
            if (_closing) return;
            string node = Path.Combine(root, "runtime", "node.exe");
            string entry = Path.Combine(root, "backend", "cli.mjs");
            string javaHome = Path.Combine(root, "runtime", "jdk");
            string python = Path.Combine(root, "runtime", "python", "python.exe");
            RequireFile(node, "Node.js");
            RequireFile(entry, "CodeFlow Studio");
            RequireFile(Path.Combine(javaHome, "bin", "java.exe"), "Java");
            RequireFile(Path.Combine(javaHome, "bin", "javac.exe"), "Java compiler");
            RequireFile(python, "Python");

            NativeJob job = new NativeJob();
            Process process = new Process();
            bool started = false;
            process.StartInfo = new ProcessStartInfo();
            process.StartInfo.FileName = node;
            process.StartInfo.Arguments = Quote(entry) + " serve --port 0";
            process.StartInfo.WorkingDirectory = root;
            process.StartInfo.UseShellExecute = false;
            process.StartInfo.CreateNoWindow = true;
            process.StartInfo.WindowStyle = ProcessWindowStyle.Hidden;
            process.StartInfo.RedirectStandardOutput = true;
            process.StartInfo.RedirectStandardError = true;
            process.EnableRaisingEvents = true;
            process.StartInfo.EnvironmentVariables["CODEFLOW_ROOT"] = root;
            process.StartInfo.EnvironmentVariables["CODEFLOW_JAVA_HOME"] = javaHome;
            process.StartInfo.EnvironmentVariables["CODEFLOW_PYTHON"] = python;
            process.OutputDataReceived += BackendOutput;
            process.ErrorDataReceived += BackendError;
            process.Exited += BackendExited;
            try
            {
                if (_closing) throw new OperationCanceledException();
                if (!process.Start()) throw new InvalidOperationException("No se pudo arrancar el servidor local.");
                started = true;
                job.Assign(process);
                _job = job;
                _backend = process;
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
            }
            catch
            {
                if (started) { try { process.Kill(); } catch { } }
                job.Dispose();
                process.Dispose();
                throw;
            }
        }

        private void BackendOutput(object sender, DataReceivedEventArgs args)
        {
            if (args.Data == null) return;
            lock (_outputLock) _stdout.AppendLine(args.Data);
            if (!args.Data.StartsWith(ReadyPrefix, StringComparison.Ordinal)) return;
            string value = args.Data.Substring(ReadyPrefix.Length).Trim();
            Uri parsed;
            if (Uri.TryCreate(value, UriKind.Absolute, out parsed) &&
                String.Equals(parsed.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) &&
                (String.Equals(parsed.Host, "127.0.0.1", StringComparison.OrdinalIgnoreCase) ||
                 String.Equals(parsed.Host, "localhost", StringComparison.OrdinalIgnoreCase)))
                _url.TrySetResult(parsed.ToString());
        }

        private void BackendError(object sender, DataReceivedEventArgs args)
        {
            if (args.Data != null) lock (_outputLock) _stderr.AppendLine(args.Data);
        }

        private void BackendExited(object sender, EventArgs args)
        {
            _exited.TrySetResult(true);
            if (_closing) return;
            try
            {
                if (IsHandleCreated && !IsDisposed)
                    BeginInvoke((MethodInvoker)delegate
                    {
                        if (!_closing && !IsDisposed)
                        {
                            _open.Enabled = false;
                            _status.Text = "El servidor local se ha detenido. Cierra y vuelve a abrir la aplicación.";
                        }
                    });
            }
            catch (InvalidOperationException) { }
        }

        private void OpenClicked(object sender, EventArgs args) { LaunchBrowser(); }
        private void OpenBrowser()
        {
            if (String.IsNullOrEmpty(_serverUrl) || _closing) return;
            if (Interlocked.Exchange(ref _browserOpened, 1) != 0) return;
            LaunchBrowser();
        }

        private void LaunchBrowser()
        {
            if (String.IsNullOrEmpty(_serverUrl) || _closing) return;
            try { Process.Start(new ProcessStartInfo(_serverUrl) { UseShellExecute = true }); }
            catch (Exception error)
            {
                Interlocked.Exchange(ref _browserOpened, 0);
                WriteLog("Browser launch failed", error);
                MessageBox.Show(this, "No se pudo abrir el navegador. Usa el botón para volver a intentarlo.\r\n" + _serverUrl,
                    "CodeFlow Studio", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }

        private void CloseClicked(object sender, EventArgs args) { Close(); }
        private void FormIsClosing(object sender, FormClosingEventArgs args)
        {
            _closing = true;
            _url.TrySetCanceled();
            StopBackend();
        }

        private void StopBackend()
        {
            if (_job != null) { _job.Dispose(); _job = null; }
            if (_backend != null) { try { _backend.Dispose(); } catch { } _backend = null; }
        }

        private string GetDiagnostics()
        {
            lock (_outputLock) return "stdout:\r\n" + _stdout + "\r\nstderr:\r\n" + _stderr;
        }

        private static string Quote(string value)
        {
            if (value.IndexOf('"') >= 0) throw new ArgumentException("A Windows file path cannot contain a quote.", "value");
            return "\"" + value + "\"";
        }

        private static void RequireFile(string path, string name)
        {
            if (!File.Exists(path)) throw new FileNotFoundException("Falta el componente " + name + " en el paquete.", path);
        }

        private static string ExtractPayload(Func<bool> cancelled)
        {
            if (!Regex.IsMatch(PayloadId, "^[0-9a-fA-F]{16}$"))
                throw new InvalidOperationException("El paquete no tiene un identificador de versión válido.");
            CheckCancelled(cancelled);
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (String.IsNullOrEmpty(local)) throw new InvalidOperationException("No se encontró la carpeta local de datos del usuario.");
            string parent = Path.Combine(local, "CodeFlowStudio");
            string destination = Path.Combine(parent, PayloadId.ToLowerInvariant());
            Directory.CreateDirectory(parent);
            ValidateDestinationPath(parent, destination);
            CheckCancelled(cancelled);
            if (IsReady(destination)) return destination;

            string staging = Path.Combine(parent, ".staging-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(staging);
            try
            {
                string zipPath = Path.Combine(staging, "payload.zip");
                Stream resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip");
                if (resource == null) throw new InvalidOperationException("No se encontró el recurso integrado payload.zip.");
                using (resource)
                using (FileStream output = new FileStream(zipPath, FileMode.CreateNew, FileAccess.Write, FileShare.None)) resource.CopyTo(output);
                CheckCancelled(cancelled);
                ValidateArchive(zipPath, staging);
                ZipFile.ExtractToDirectory(zipPath, staging);
                File.Delete(zipPath);
                ValidatePayloadFiles(staging);
                CheckCancelled(cancelled);
                File.WriteAllText(Path.Combine(staging, ".ready"), PayloadId, new UTF8Encoding(false));
                CheckCancelled(cancelled);
                if (Directory.Exists(destination))
                {
                    if (IsReady(destination)) return destination;
                    SafeDeleteInvalidDestination(parent, destination);
                }
                try { Directory.Move(staging, destination); }
                catch (IOException)
                {
                    if (IsReady(destination)) return destination;
                    throw;
                }
                return destination;
            }
            finally
            {
                if (Directory.Exists(staging))
                {
                    try { Directory.Delete(staging, true); }
                    catch (IOException) { }
                    catch (UnauthorizedAccessException) { }
                }
            }
        }

        private static void CheckCancelled(Func<bool> cancelled)
        {
            if (cancelled != null && cancelled()) throw new OperationCanceledException();
        }

        private static bool IsReady(string directory)
        {
            try
            {
                if (!Directory.Exists(directory)) return false;
                string parent = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CodeFlowStudio");
                ValidateDestinationPath(parent, directory);
                if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) return false;
                string marker = File.ReadAllText(Path.Combine(directory, ".ready"), Encoding.UTF8).Trim();
                if (!String.Equals(marker, PayloadId, StringComparison.OrdinalIgnoreCase)) return false;
                ValidatePayloadFiles(directory);
                return true;
            }
            catch { return false; }
        }

        private static void ValidateDestinationPath(string parent, string destination)
        {
            string fullParent = Path.GetFullPath(parent).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string fullDestination = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (!String.Equals(Path.GetDirectoryName(fullDestination), fullParent, StringComparison.OrdinalIgnoreCase) ||
                !String.Equals(Path.GetFileName(fullDestination), PayloadId.ToLowerInvariant(), StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("La ruta de instalación del paquete no es válida.");
        }

        private static void SafeDeleteInvalidDestination(string parent, string destination)
        {
            ValidateDestinationPath(parent, destination);
            FileAttributes attributes = File.GetAttributes(destination);
            if ((attributes & FileAttributes.ReparsePoint) != 0 || (attributes & FileAttributes.Directory) == 0)
                throw new InvalidOperationException("La carpeta de instalación existente no es segura para reemplazar.");
            Directory.Delete(destination, true);
        }

        private static void ValidatePayloadFiles(string root)
        {
            RequireFile(Path.Combine(root, "runtime", "node.exe"), "Node.js");
            RequireFile(Path.Combine(root, "runtime", "python", "python.exe"), "Python");
            RequireFile(Path.Combine(root, "runtime", "jdk", "bin", "java.exe"), "Java");
            RequireFile(Path.Combine(root, "runtime", "jdk", "bin", "javac.exe"), "Java compiler");
            RequireFile(Path.Combine(root, "backend", "cli.mjs"), "CodeFlow Studio");
            RequireFile(Path.Combine(root, "backend", "smoke.mjs"), "Comprobación local");
            RequireFile(Path.Combine(root, "web", "index.html"), "Interfaz web");
            RequireFile(Path.Combine(root, "web", "styles.css"), "Estilos web");
            RequireFile(Path.Combine(root, ".build", "app.js"), "Aplicación web");
            RequireFile(Path.Combine(root, "examples", "catalog.json"), "Ejemplos");
            RequireFile(Path.Combine(root, "adapters", "java", "CodeFlowTracer.java"), "Adaptador Java");
            RequireFile(Path.Combine(root, "adapters", "java", "CodeFlowTarget.java"), "Adaptador Java");
            RequireFile(Path.Combine(root, "adapters", "java", "CodeFlowAnalyze.java"), "Analizador Java");
            RequireFile(Path.Combine(root, "adapters", "python", "tracer.py"), "Adaptador Python");
            RequireFile(Path.Combine(root, "adapters", "python", "analyze.py"), "Analizador Python");
        }

        private static void ValidateArchive(string zipPath, string destination)
        {
            string fullRoot = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            using (FileStream file = File.OpenRead(zipPath))
            using (ZipArchive archive = new ZipArchive(file, ZipArchiveMode.Read, false))
            {
                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    string name = entry.FullName.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar);
                    if (Path.IsPathRooted(name) || name.IndexOf(':') >= 0)
                        throw new InvalidDataException("El paquete contiene una ruta no válida.");
                    string target = Path.GetFullPath(Path.Combine(destination, name));
                    if (!target.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("El paquete contiene una ruta fuera de la instalación.");
                }
            }
        }

        public static int RunSelfTest(string diagnosticsPath)
        {
            NativeJob job = null;
            Process process = null;
            StringBuilder stdout = new StringBuilder();
            StringBuilder stderr = new StringBuilder();
            object outputLock = new object();
            int exitCode = 1;
            string diagnostics = String.Empty;
            try
            {
                string root = ExtractPayload(null);
                string node = Path.Combine(root, "runtime", "node.exe");
                string smoke = Path.Combine(root, "backend", "smoke.mjs");
                string javaHome = Path.Combine(root, "runtime", "jdk");
                string python = Path.Combine(root, "runtime", "python", "python.exe");
                RequireFile(node, "Node.js");
                RequireFile(smoke, "Comprobación local");
                job = new NativeJob();
                process = new Process();
                process.StartInfo = new ProcessStartInfo();
                process.StartInfo.FileName = node;
                process.StartInfo.Arguments = Quote(smoke);
                process.StartInfo.WorkingDirectory = root;
                process.StartInfo.UseShellExecute = false;
                process.StartInfo.CreateNoWindow = true;
                process.StartInfo.WindowStyle = ProcessWindowStyle.Hidden;
                process.StartInfo.RedirectStandardOutput = true;
                process.StartInfo.RedirectStandardError = true;
                process.EnableRaisingEvents = true;
                process.StartInfo.EnvironmentVariables["CODEFLOW_ROOT"] = root;
                process.StartInfo.EnvironmentVariables["CODEFLOW_JAVA_HOME"] = javaHome;
                process.StartInfo.EnvironmentVariables["CODEFLOW_PYTHON"] = python;
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
                { if (e.Data != null) lock (outputLock) stdout.AppendLine(e.Data); };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
                { if (e.Data != null) lock (outputLock) stderr.AppendLine(e.Data); };
                if (!process.Start()) throw new InvalidOperationException("No se pudo iniciar la comprobación del paquete.");
                job.Assign(process);
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                if (!process.WaitForExit(120000))
                {
                    job.Dispose();
                    job = null;
                    try { process.Kill(); } catch { }
                    try { process.WaitForExit(5000); } catch { }
                    if (process.HasExited) process.WaitForExit();
                    exitCode = 124;
                    lock (outputLock) diagnostics = "Exit code: 124\r\nSelf-test timed out after 120 seconds.\r\nstdout:\r\n" + stdout + "\r\nstderr:\r\n" + stderr;
                    return exitCode;
                }
                process.WaitForExit();
                exitCode = process.ExitCode;
                lock (outputLock) diagnostics = "Exit code: " + exitCode + "\r\nstdout:\r\n" + stdout + "\r\nstderr:\r\n" + stderr;
            }
            catch (Exception error)
            {
                if (process != null)
                {
                    try { if (!process.HasExited) process.Kill(); }
                    catch { }
                }
                diagnostics = "Exit code: 1\r\n" + error;
                WriteLog("Self-test failed", error);
                exitCode = 1;
            }
            finally
            {
                if (job != null) job.Dispose();
                if (process != null) process.Dispose();
                try
                {
                    string fullPath = Path.GetFullPath(diagnosticsPath);
                    string directory = Path.GetDirectoryName(fullPath);
                    if (!String.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
                    File.WriteAllText(fullPath, diagnostics, new UTF8Encoding(false));
                }
                catch (Exception error)
                {
                    WriteLog("Could not write self-test diagnostics", error);
                    if (exitCode == 0) exitCode = 1;
                }
            }
            return exitCode;
        }

        public static void WriteLog(string message, Exception error)
        {
            try
            {
                string directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CodeFlowStudio");
                Directory.CreateDirectory(directory);
                File.AppendAllText(Path.Combine(directory, "launcher.log"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message + "\r\n" + error + "\r\n\r\n", new UTF8Encoding(false));
            }
            catch { }
        }
    }

    internal sealed class NativeJob : IDisposable
    {
        private const uint ExtendedLimitInformation = 9;
        private const uint KillOnJobClose = 0x00002000;
        private IntPtr _handle;

        public NativeJob()
        {
            _handle = CreateJobObject(IntPtr.Zero, null);
            if (_handle == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "No se pudo crear el control de procesos del launcher.");
            ExtendedInformation info = new ExtendedInformation();
            info.Basic.LimitFlags = KillOnJobClose;
            uint size = (uint)Marshal.SizeOf(typeof(ExtendedInformation));
            if (!SetInformationJobObject(_handle, ExtendedLimitInformation, ref info, size))
            {
                int error = Marshal.GetLastWin32Error();
                CloseHandle(_handle);
                _handle = IntPtr.Zero;
                throw new System.ComponentModel.Win32Exception(error, "No se pudo configurar el control de procesos del launcher.");
            }
        }

        public void Assign(Process process)
        {
            if (_handle == IntPtr.Zero) throw new ObjectDisposedException("NativeJob");
            if (!AssignProcessToJobObject(_handle, process.Handle))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "No se pudo asociar el servidor al launcher.");
        }

        public void Dispose()
        {
            if (_handle == IntPtr.Zero) return;
            CloseHandle(_handle);
            _handle = IntPtr.Zero;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct BasicInformation
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IoCounters
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ExtendedInformation
        {
            public BasicInformation Basic;
            public IoCounters Io;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetInformationJobObject(IntPtr job, uint infoClass, ref ExtendedInformation info, uint length);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr handle);
    }
}
