using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace CyreneAchievementScanner;

public partial class MainWindow : System.Windows.Window
{
    private Process? _scanner;
    private CancellationTokenSource? _scanCancellation;
    private string? _scanDirectory;
    private string? _exportPath;
    private readonly StringBuilder _scannerOutput = new();

    public MainWindow()
    {
        InitializeComponent();
    }

    protected override void OnClosed(EventArgs e)
    {
        _scanCancellation?.Cancel();
        if (_scanner is { HasExited: false }) _scanner.Kill(entireProcessTree: true);
        DeleteScanDirectory();
        base.OnClosed(e);
    }

    private void BrowseGame_Click(object sender, System.Windows.RoutedEventArgs e) =>
        BrowseExecutable(GamePathBox, "Genshin Impact|GenshinImpact.exe;YuanShen.exe");

    private void AutoDetectGame_Click(object sender, System.Windows.RoutedEventArgs e)
    {
        ErrorText.Text = "";
        var detectedPath = DetectGamePath();

        if (detectedPath is null)
        {
            ErrorText.Text = "Genshin could not be detected automatically. Use Browse to select the executable.";
            return;
        }

        GamePathBox.Text = detectedPath;
    }

    private static string? DetectGamePath()
    {
        var localLow = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "..", "LocalLow", "miHoYo");

        foreach (var productName in new[] { "Genshin Impact", "原神" })
        {
            foreach (var logName in new[] { "output_log.txt", "output_log.txt.last" })
            {
                var logPath = Path.GetFullPath(Path.Combine(localLow, productName, logName));
                var pathFromLog = TryReadGamePathFromLog(logPath);
                if (pathFromLog is not null) return pathFromLog;
            }
        }

        var roots = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            @"C:\Program Files",
            @"C:\Program Files (x86)",
            @"C:\Program Files\HoYoPlay\games",
            @"D:\HoYoPlay\games",
            @"D:\Games",
            @"E:\HoYoPlay\games",
            @"E:\Games",
        };

        var relativePaths = new[]
        {
            @"HoYoPlay\games\Genshin Impact game\GenshinImpact.exe",
            @"HoYoPlay\games\Genshin Impact\GenshinImpact.exe",
            @"HoYoPlay\games\原神游戏\YuanShen.exe",
            @"Genshin Impact game\GenshinImpact.exe",
            @"Genshin Impact\GenshinImpact.exe",
            @"原神游戏\YuanShen.exe",
        };

        return roots
            .Where(root => !string.IsNullOrWhiteSpace(root))
            .SelectMany(root => relativePaths.Select(relative => Path.Combine(root, relative)))
            .FirstOrDefault(File.Exists);
    }

    private static string? TryReadGamePathFromLog(string logPath)
    {
        if (!File.Exists(logPath)) return null;

        try
        {
            var match = Regex.Match(
                File.ReadAllText(logPath),
                @"(?m)(?<data>[A-Za-z]:[\\/].+?(?:GenshinImpact_Data|YuanShen_Data))");

            if (!match.Success) return null;

            var dataDirectory = match.Groups["data"].Value.Replace('/', Path.DirectorySeparatorChar);
            var executableName = dataDirectory.EndsWith("YuanShen_Data", StringComparison.OrdinalIgnoreCase)
                ? "YuanShen.exe"
                : "GenshinImpact.exe";
            var executablePath = Path.GetFullPath(Path.Combine(dataDirectory, "..", executableName));
            return File.Exists(executablePath) ? executablePath : null;
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static void BrowseExecutable(System.Windows.Controls.TextBox target, string filter)
    {
        var dialog = new OpenFileDialog { Filter = filter, CheckFileExists = true };
        if (dialog.ShowDialog() == true) target.Text = dialog.FileName;
    }

    private async void StartScan_Click(object sender, System.Windows.RoutedEventArgs e)
    {
        ErrorText.Text = "";
        var gamePath = GamePathBox.Text.Trim();

        if (!File.Exists(gamePath) || !(gamePath.EndsWith("GenshinImpact.exe", StringComparison.OrdinalIgnoreCase) || gamePath.EndsWith("YuanShen.exe", StringComparison.OrdinalIgnoreCase)))
        {
            ErrorText.Text = "Select a valid Genshin executable.";
            return;
        }
        if (Process.GetProcessesByName("GenshinImpact").Length > 0 || Process.GetProcessesByName("YuanShen").Length > 0)
        {
            ErrorText.Text = "Close Genshin before starting the scan.";
            return;
        }

        _scanDirectory = Path.Combine(Path.GetTempPath(), "CyreneAchievementScanner", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_scanDirectory);
        _scanCancellation = new CancellationTokenSource();
        ShowPanel(ProgressPanel);

        try
        {
            PreventHiddenCachePrompt();
            var scannerPath = await ExtractScannerAsync(_scanDirectory, _scanCancellation.Token);
            var startInfo = new ProcessStartInfo
            {
                FileName = scannerPath,
                WorkingDirectory = _scanDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            startInfo.ArgumentList.Add(gamePath);
            startInfo.ArgumentList.Add("7"); // Yae's UIAF JSON export.
            startInfo.ArgumentList.Add("false");

            _scannerOutput.Clear();
            _scanner = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
            _scanner.OutputDataReceived += CaptureScannerOutput;
            _scanner.ErrorDataReceived += CaptureScannerOutput;

            if (!_scanner.Start()) throw new InvalidOperationException("The scanner did not start.");
            _scanner.BeginOutputReadLine();
            _scanner.BeginErrorReadLine();
            ProgressTitle.Text = "Waiting for achievement data";
            ProgressDescription.Text = "Sign in to Genshin and enter the game. Cyrene will detect the completed scan automatically.";

            _exportPath = await WaitForExportAsync(
                _scanner,
                _scanDirectory,
                _scanCancellation.Token,
                () => GetScannerError());
            SuccessDescription.Text = "Your UIAF achievement export is ready to import into Cyrene.";
            ShowPanel(SuccessPanel);
        }
        catch (OperationCanceledException)
        {
            ShowPanel(SetupPanel);
        }
        catch (Exception error)
        {
            ShowPanel(SetupPanel);
            ErrorText.Text = error.Message;
        }
    }

    private void CaptureScannerOutput(object sender, DataReceivedEventArgs eventArgs)
    {
        if (string.IsNullOrWhiteSpace(eventArgs.Data)) return;

        lock (_scannerOutput)
        {
            _scannerOutput.AppendLine(eventArgs.Data);
        }
    }

    private string GetScannerError()
    {
        lock (_scannerOutput)
        {
            var lines = _scannerOutput
                .ToString()
                .Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
                .TakeLast(4);
            return string.Join(Environment.NewLine, lines);
        }
    }

    private static void PreventHiddenCachePrompt()
    {
        var cacheName = Convert.ToHexStringLower(
            MD5.HashData(Encoding.UTF8.GetBytes("achievement_data"))) + ".nyan";
        var cachePath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "Yae", "cache", cacheName);

        if (File.Exists(cachePath) && File.GetLastWriteTimeUtc(cachePath).AddMinutes(60) > DateTime.UtcNow)
        {
            File.SetLastWriteTimeUtc(cachePath, DateTime.UtcNow.AddHours(-2));
        }
    }

    private static async Task<string> ExtractScannerAsync(string directory, CancellationToken cancellationToken)
    {
        const string resourceName = "CyreneAchievementScanner.YaeAchievement.exe";
        await using var resource = typeof(MainWindow).Assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException(
                "The bundled Yae scanner is missing. Build AchievementScanner.exe with build.ps1.");

        var path = Path.Combine(directory, "YaeAchievement.exe");
        await using var output = File.Create(path);
        await resource.CopyToAsync(output, cancellationToken);
        return path;
    }

    private static async Task<string> WaitForExportAsync(
        Process process,
        string directory,
        CancellationToken cancellationToken,
        Func<string> getScannerError)
    {
        while (!process.HasExited)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var export = Directory.EnumerateFiles(directory, "uiaf-*.json").OrderByDescending(File.GetLastWriteTimeUtc).FirstOrDefault();
            if (export is not null) return export;
            await Task.Delay(500, cancellationToken);
        }

        var finalExport = Directory.EnumerateFiles(directory, "uiaf-*.json").OrderByDescending(File.GetLastWriteTimeUtc).FirstOrDefault();
        if (finalExport is not null) return finalExport;

        var scannerError = getScannerError();
        var detail = string.IsNullOrWhiteSpace(scannerError)
            ? "No additional details were reported."
            : scannerError;
        throw new InvalidOperationException(
            $"The scanner stopped without launching Genshin or producing an export " +
            $"(exit code {process.ExitCode}).{Environment.NewLine}{detail}");
    }

    private void Cancel_Click(object sender, System.Windows.RoutedEventArgs e)
    {
        _scanCancellation?.Cancel();
        if (_scanner is { HasExited: false }) _scanner.Kill(entireProcessTree: true);
    }

    private void SaveExport_Click(object sender, System.Windows.RoutedEventArgs e)
    {
        if (_exportPath is null) return;
        var dialog = new SaveFileDialog
        {
            Filter = "JSON file|*.json",
            FileName = $"Cyrene-Achievement-{DateTime.Now:dd-MM-yyyy}.json",
            DefaultExt = ".json",
            AddExtension = true,
        };
        if (dialog.ShowDialog() == true) File.Copy(_exportPath, dialog.FileName, overwrite: true);
    }

    private void OpenCyrene_Click(object sender, System.Windows.RoutedEventArgs e) =>
        Process.Start(new ProcessStartInfo("https://cyrene.apps.bot-hosting.cloud/achievements") { UseShellExecute = true });

    private void OpenYaeSource_Click(object sender, System.Windows.RoutedEventArgs e) =>
        Process.Start(new ProcessStartInfo("https://github.com/HolographicHat/Yae") { UseShellExecute = true });

    private void Reset_Click(object sender, System.Windows.RoutedEventArgs e)
    {
        _exportPath = null;
        DeleteScanDirectory();
        ShowPanel(SetupPanel);
    }

    private void DeleteScanDirectory()
    {
        if (_scanDirectory is null || !Directory.Exists(_scanDirectory)) return;

        try
        {
            Directory.Delete(_scanDirectory, recursive: true);
            _scanDirectory = null;
        }
        catch (IOException)
        {
            // Windows may still be releasing the scanner executable.
        }
        catch (UnauthorizedAccessException)
        {
            // A later scan uses a different directory, so a locked file is harmless.
        }
    }

    private void ShowPanel(System.Windows.UIElement panel)
    {
        SetupPanel.Visibility = System.Windows.Visibility.Collapsed;
        ProgressPanel.Visibility = System.Windows.Visibility.Collapsed;
        SuccessPanel.Visibility = System.Windows.Visibility.Collapsed;
        panel.Visibility = System.Windows.Visibility.Visible;
    }
}
