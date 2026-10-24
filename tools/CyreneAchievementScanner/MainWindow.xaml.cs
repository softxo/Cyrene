using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace CyreneAchievementScanner;

public partial class MainWindow : System.Windows.Window
{
    private Process? _scanner;
    private CancellationTokenSource? _scanCancellation;
    private CancellationTokenSource? _wishScanCancellation;
    private string? _scanDirectory;
    private string? _exportPath;
    private string? _wishUrl;
    private readonly StringBuilder _scannerOutput = new();

    public MainWindow()
    {
        InitializeComponent();
        var version = Assembly.GetExecutingAssembly().GetName().Version;
        VersionText.Text = version is null
            ? ""
            : $"v{version.Major}.{version.Minor}.{version.Build}";
    }

    private void ChooseAchievements_Click(object sender, System.Windows.RoutedEventArgs e) =>
        ShowPanel(SetupPanel);

    private void ChooseWishes_Click(object sender, System.Windows.RoutedEventArgs e)
    {
        WishStatusText.Text = "";
        if (string.IsNullOrWhiteSpace(WishGamePathBox.Text))
        {
            WishGamePathBox.Text = GamePathBox.Text;
        }
        ShowPanel(WishPanel);
    }

    private void BackToHub_Click(object sender, System.Windows.RoutedEventArgs e)
    {
        _wishScanCancellation?.Cancel();
        ErrorText.Text = "";
        WishStatusText.Text = "";
        ShowPanel(HubPanel);
    }

    private void BrowseWishGame_Click(object sender, System.Windows.RoutedEventArgs e) =>
        BrowseExecutable(WishGamePathBox, "Genshin Impact|GenshinImpact.exe;YuanShen.exe");

    private void AutoDetectWishGame_Click(object sender, System.Windows.RoutedEventArgs e)
    {
        WishStatusText.Text = "";
        var detectedPath = DetectGamePath();
        if (detectedPath is null)
        {
            WishStatusText.Foreground = (System.Windows.Media.Brush)FindResource("ErrorBrush");
            WishStatusText.Text = "Genshin could not be detected automatically. Use Browse to select the executable.";
            return;
        }

        WishGamePathBox.Text = detectedPath;
    }

    private async void StartWish_Click(object sender, System.Windows.RoutedEventArgs e)
    {
        var gamePath = WishGamePathBox.Text.Trim();
        WishStatusText.Foreground = (System.Windows.Media.Brush)FindResource("MutedBrush");
        WishStatusText.Text = "";

        try
        {
            ValidateGamePath(gamePath);
            var baseline = await GetWishScanBaselineAsync(gamePath);
            _wishScanCancellation = new CancellationTokenSource();

            if (Process.GetProcessesByName("GenshinImpact").Length == 0 &&
                Process.GetProcessesByName("YuanShen").Length == 0)
            {
                Process.Start(new ProcessStartInfo(gamePath)
                {
                    UseShellExecute = true,
                    WorkingDirectory = Path.GetDirectoryName(gamePath),
                });
            }

            ShowPanel(WishProgressPanel);
            _wishUrl = await WaitForWishUrlAsync(gamePath, baseline, _wishScanCancellation.Token);
            System.Windows.Clipboard.SetText(_wishUrl);
            ShowPanel(WishSuccessPanel);
        }
        catch (OperationCanceledException)
        {
            ShowPanel(WishPanel);
        }
        catch (Exception error)
        {
            ShowPanel(WishPanel);
            WishStatusText.Foreground = (System.Windows.Media.Brush)FindResource("ErrorBrush");
            WishStatusText.Text = $"The wish scan could not start: {error.Message}";
        }
    }

    private static void ValidateGamePath(string gamePath)
    {
        if (!File.Exists(gamePath) ||
            !(gamePath.EndsWith("GenshinImpact.exe", StringComparison.OrdinalIgnoreCase) ||
              gamePath.EndsWith("YuanShen.exe", StringComparison.OrdinalIgnoreCase)))
        {
            throw new InvalidOperationException("Select a valid Genshin executable.");
        }
    }

    private readonly record struct WishScanBaseline(DateTime CacheModifiedUtc, string? Url);

    private static async Task<WishScanBaseline> GetWishScanBaselineAsync(string gamePath)
    {
        try
        {
            var cachePath = GetWishCachePath(gamePath);
            var url = await FindWishUrlAsync(gamePath);
            return new WishScanBaseline(File.GetLastWriteTimeUtc(cachePath), url);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            return new WishScanBaseline(DateTime.MinValue, null);
        }
    }

    private static async Task<string> WaitForWishUrlAsync(
        string gamePath,
        WishScanBaseline baseline,
        CancellationToken cancellationToken)
    {
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var cachePath = GetWishCachePath(gamePath);
                var cacheModifiedUtc = File.GetLastWriteTimeUtc(cachePath);
                if (cacheModifiedUtc > baseline.CacheModifiedUtc)
                {
                    var url = await FindWishUrlAsync(gamePath);
                    if (!string.Equals(url, baseline.Url, StringComparison.Ordinal))
                    {
                        return url;
                    }
                }
            }
            catch (IOException)
            {
                // The cache may not exist or may be locked until Wish History opens.
            }
            catch (UnauthorizedAccessException)
            {
                // Chromium can briefly lock its cache while updating it.
            }
            catch (InvalidOperationException)
            {
                // No valid URL has been written yet; keep waiting.
            }
            await Task.Delay(1000, cancellationToken);
        }
    }

    private static async Task<string> FindWishUrlAsync(string gamePath)
    {
        var cachePath = GetWishCachePath(gamePath);

        var cacheText = await ReadLiveCacheTextAsync(cachePath);
        foreach (var section in cacheText.Split("1/0/", StringSplitOptions.RemoveEmptyEntries).Reverse())
        {
            var url = section.Split('\0', 2)[0];
            if (!url.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ||
                !(url.Contains("getGachaLog", StringComparison.OrdinalIgnoreCase) ||
                  url.Contains("getLdGachaLog", StringComparison.OrdinalIgnoreCase)) ||
                !Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
                !(uri.Host.EndsWith(".hoyoverse.com", StringComparison.OrdinalIgnoreCase) ||
                  uri.Host.EndsWith(".mihoyo.com", StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            return url;
        }

        throw new InvalidOperationException("No valid wish-history URL was found. Open Wish History in Genshin and try again before it expires.");
    }

    private static async Task<string> ReadLiveCacheTextAsync(string cachePath)
    {
        await using var cache = new FileStream(
            cachePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete,
            bufferSize: 81920,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        using var memory = new MemoryStream();
        await cache.CopyToAsync(memory);
        return Encoding.UTF8.GetString(memory.GetBuffer(), 0, checked((int)memory.Length));
    }

    private static string GetWishCachePath(string gamePath)
    {
        ValidateGamePath(gamePath);

        var executableName = Path.GetFileNameWithoutExtension(gamePath);
        var dataDirectory = Path.Combine(Path.GetDirectoryName(gamePath)!, $"{executableName}_Data");
        var webCachesDirectory = Path.Combine(dataDirectory, "webCaches");
        if (!Directory.Exists(webCachesDirectory))
        {
            throw new DirectoryNotFoundException("Genshin's web cache could not be found. Open Wish History in the game, then try again.");
        }

        return Directory.EnumerateDirectories(webCachesDirectory)
            .Where(path => Regex.IsMatch(Path.GetFileName(path), @"^\d+\.\d+\.\d+\.\d+$"))
            .OrderByDescending(path => Path.GetFileName(path), StringComparer.OrdinalIgnoreCase)
            .Select(path => Path.Combine(path, "Cache", "Cache_Data", "data_2"))
            .FirstOrDefault(File.Exists)
            ?? throw new FileNotFoundException("Genshin's wish cache is empty. Open Wish History in the game, then try again.");
    }

    private void CopyWishUrl_Click(object sender, System.Windows.RoutedEventArgs e)
    {
        if (_wishUrl is not null) System.Windows.Clipboard.SetText(_wishUrl);
        WishSuccessDescription.Text = "The wish-history URL has been copied again.";
    }

    private void ResetWish_Click(object sender, System.Windows.RoutedEventArgs e)
    {
        _wishUrl = null;
        WishStatusText.Text = "";
        ShowPanel(WishPanel);
    }

    private void CancelWish_Click(object sender, System.Windows.RoutedEventArgs e) =>
        _wishScanCancellation?.Cancel();

    private void OpenStarDbSource_Click(object sender, System.Windows.RoutedEventArgs e) =>
        Process.Start(new ProcessStartInfo("https://github.com/juliuskreutz/stardb-exporter") { UseShellExecute = true });

    protected override void OnClosed(EventArgs e)
    {
        _scanCancellation?.Cancel();
        _wishScanCancellation?.Cancel();
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
        HubPanel.Visibility = System.Windows.Visibility.Collapsed;
        SetupPanel.Visibility = System.Windows.Visibility.Collapsed;
        WishPanel.Visibility = System.Windows.Visibility.Collapsed;
        WishProgressPanel.Visibility = System.Windows.Visibility.Collapsed;
        WishSuccessPanel.Visibility = System.Windows.Visibility.Collapsed;
        ProgressPanel.Visibility = System.Windows.Visibility.Collapsed;
        SuccessPanel.Visibility = System.Windows.Visibility.Collapsed;
        panel.Visibility = System.Windows.Visibility.Visible;
    }
}
