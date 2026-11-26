param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$Out,
  # a screen size to switch to first (0: keep the runner's)
  [int]$Width = 0,
  [int]$Height = 0
)
# Smoke check of the Windows installer on a hosted runner (windows-build.yml):
# installs it silently, starts Dosik and walks through what the window frame
# does on Windows - first placement, the Snap layouts spot, the window menu,
# F11, Maximize, browser keys, the bridge, Ctrl+W - with real mouse and key
# input (SendInput). What can be measured is checked (window and child
# rectangles, open popup menus, bridge answers, the process); what can only be
# seen is left to the screenshots. Writes log.txt, checks.md and screenshots
# to $Out, the checks to the job summary, and exits 1 when a check fails.
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$log = Join-Path $Out 'log.txt'
"begin" | Out-File $log -Encoding utf8
function Log($m) { "$(Get-Date -Format HH:mm:ss.fff) $m" | Out-File $log -Append -Encoding utf8; Write-Host $m }

$checks = New-Object System.Collections.Generic.List[object]
function Check($name, [bool]$ok, $detail) {
  $checks.Add([pscustomobject]@{ Name = $name; Ok = $ok; Detail = "$detail" })
  Log "check $(if ($ok) { 'PASS' } else { 'FAIL' }) $name - $detail"
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
# a script error still ends in the summary, as a failed check
trap {
  if ($script:finishing) { exit 1 }
  Check "smoke script ran to its end" $false $_.Exception.Message
  Finish
}
try {
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  // the client area in screen coordinates: what the web view fills
  public static RECT Client(IntPtr h) {
    RECT c; GetClientRect(h, out c); var o = new POINT(); ClientToScreen(h, ref o);
    var r = new RECT(); r.L = o.X; r.T = o.Y; r.R = o.X + c.R; r.B = o.Y + c.B; return r;
  }
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a, uint b, out RECT r, uint c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  public static string Cls(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
  public static string Txt(IntPtr h) { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); return sb.ToString(); }
  public static string Rect(IntPtr h) { RECT r; GetWindowRect(h, out r); return r.L + "," + r.T + "," + r.R + "," + r.B; }
  public static List<string> Children(IntPtr p) {
    var list = new List<string>();
    EnumChildWindows(p, (h, l) => { list.Add(Cls(h) + " visible=" + IsWindowVisible(h) + " rect=" + Rect(h)); return true; }, IntPtr.Zero);
    return list;
  }
  public static IntPtr Child(IntPtr p, string cls) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(p, (h, l) => { if (Cls(h) == cls) { found = h; return false; } return true; }, IntPtr.Zero);
    return found;
  }
  public static IntPtr ProcWindow(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid && Txt(h) == "Dosik") { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  // visible top-level windows as "class|pid|rect"
  public static List<string> TopLevel() {
    var list = new List<string>();
    EnumWindows((h, l) => {
      if (IsWindowVisible(h)) { uint p; GetWindowThreadProcessId(h, out p); list.Add(Cls(h) + "|" + p + "|" + Txt(h) + "|" + Rect(h)); }
      return true;
    }, IntPtr.Zero);
    return list;
  }
  public static int CountClass(string cls) {
    int n = 0;
    EnumWindows((h, l) => { if (IsWindowVisible(h) && Cls(h) == cls) n++; return true; }, IntPtr.Zero);
    return n;
  }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint data, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct U { [FieldOffset(0)] public MOUSEINPUT m; [FieldOffset(0)] public KEYBDINPUT k; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public U u; }
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  static int AX(int x) { return x * 65535 / (GetSystemMetrics(0) - 1); }
  static int AY(int y) { return y * 65535 / (GetSystemMetrics(1) - 1); }
  public static void Mouse(int x, int y, uint extra) {
    var i = new INPUT[1]; i[0].type = 0;
    i[0].u.m.dx = AX(x); i[0].u.m.dy = AY(y); i[0].u.m.flags = 0x8000 | 0x0001 | extra;
    SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Move(int x, int y) { Mouse(x, y, 0); }
  public static void Click(int x, int y) { Mouse(x, y, 0); System.Threading.Thread.Sleep(60); Mouse(x, y, 0x0002); System.Threading.Thread.Sleep(60); Mouse(x, y, 0x0004); }
  public static void DoubleClick(int x, int y) { Click(x, y); System.Threading.Thread.Sleep(90); Mouse(x, y, 0x0002); System.Threading.Thread.Sleep(40); Mouse(x, y, 0x0004); }
  public static void RightClick(int x, int y) { Mouse(x, y, 0); System.Threading.Thread.Sleep(60); Mouse(x, y, 0x0008); System.Threading.Thread.Sleep(60); Mouse(x, y, 0x0010); }
  public static void Key(ushort vk, bool up) {
    var i = new INPUT[1]; i[0].type = 1; i[0].u.k.vk = vk; i[0].u.k.flags = up ? 2u : 0u;
    SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Tap(ushort vk) { Key(vk, false); System.Threading.Thread.Sleep(40); Key(vk, true); }
  public static void Chord(ushort mod, ushort vk) { Key(mod, false); System.Threading.Thread.Sleep(30); Tap(vk); System.Threading.Thread.Sleep(30); Key(mod, true); }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
    public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra; public int dmFields;
    public int dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
    public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
    public short dmLogPixels; public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
    public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
  }
  [DllImport("user32.dll")] public static extern int EnumDisplaySettings(string dev, int mode, ref DEVMODE dm);
  [DllImport("user32.dll")] public static extern int ChangeDisplaySettings(ref DEVMODE dm, int flags);
  public static int SetResolution(int w, int h) {
    var dm = new DEVMODE(); dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
    if (EnumDisplaySettings(null, -1, ref dm) == 0) return -100;
    dm.dmPelsWidth = w; dm.dmPelsHeight = h; dm.dmFields = 0x80000 | 0x100000;
    return ChangeDisplaySettings(ref dm, 0);
  }
}
"@
} catch { Log "add-type error=$($_.Exception.Message)"; $_.Exception.LoaderExceptions | ForEach-Object { Log "loader $_" } }
[W]::SetProcessDPIAware() | Out-Null

$VK_ESC = 0x1B; $VK_SPACE = 0x20; $VK_ALT = 0x12; $VK_CTRL = 0x11; $VK_TAB = 0x09; $VK_WIN = 0x5B
$VK_F5 = 0x74; $VK_F11 = 0x7A; $VK_F12 = 0x7B; $VK_F = 0x46; $VK_R = 0x52; $VK_W = 0x57; $VK_COMMA = 0xBC
# the design tokens: caption-button 46 px, chrome-height 40 px
$CAPTION_BUTTON = 46; $CHROME_HEIGHT = 40

function Shot($name) {
  try {
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $bmp.Save((Join-Path $Out "$name.png"))
    $g.Dispose(); $bmp.Dispose()
    Log "shot $name"
  } catch { Log "shot $name error=$($_.Exception.Message)" }
}

# the window as it is now: its client on the screen, maximized, the spot
# (not "Measure": that name is an alias of Measure-Object, and aliases win)
function WindowNow() {
  $r = New-Object W+RECT; [W]::GetWindowRect($script:h, [ref]$r) | Out-Null
  $c = [W]::Client($script:h)
  $spot = [W]::Child($script:h, 'DOSIK_MAX_SPOT')
  $s = New-Object W+RECT
  if ($spot -ne [IntPtr]::Zero) { [W]::GetWindowRect($spot, [ref]$s) | Out-Null }
  return [pscustomobject]@{
    L = $c.L; T = $c.T; R = $c.R; B = $c.B
    Outer = "$($r.L),$($r.T),$($r.R),$($r.B)"
    Zoomed = [W]::IsZoomed($script:h)
    SpotFound = $spot -ne [IntPtr]::Zero
    SpotShown = ($spot -ne [IntPtr]::Zero) -and [W]::IsWindowVisible($spot)
    SpotL = $s.L; SpotT = $s.T; SpotR = $s.R; SpotB = $s.B
    Foreground = [W]::GetForegroundWindow() -eq $script:h
  }
}
function LogState($what, $state) {
  Log "$what window=$($state.Outer) client=$(ClientText $state) zoomed=$($state.Zoomed) spot=$($state.SpotL),$($state.SpotT),$($state.SpotR),$($state.SpotB) spotShown=$($state.SpotShown) foreground=$($state.Foreground)"
}
function State($what) {
  $state = WindowNow
  LogState $what $state
  return $state
}
# the state once $done holds of it, or after $seconds - slow runners take their
# time. $done runs in this function's scope and reads the caller's variables
# through it, so the locals here carry a prefix no caller uses
function WaitState($what, [scriptblock]$done, [double]$seconds = 8) {
  $ws_clock = [System.Diagnostics.Stopwatch]::StartNew()
  do {
    Start-Sleep -Milliseconds 250
    $ws_now = WindowNow
  } until ((& $done $ws_now) -or $ws_clock.Elapsed.TotalSeconds -ge $seconds)
  # settled: one more look after a moment, so a passing frame is not taken for the end
  Start-Sleep -Milliseconds 500
  $ws_now = WindowNow
  LogState "$what after $([int]$ws_clock.Elapsed.TotalMilliseconds)ms" $ws_now
  return $ws_now
}

function ClientText($s) { "$($s.L),$($s.T),$($s.R),$($s.B)" }

# where to point: the middle of Maximize and Close, an empty place of the band, the body
function Points($s) {
  $btn = $CAPTION_BUTTON * $script:scale
  $mid = [int]($s.T + ($CHROME_HEIGHT / 2) * $script:scale)
  return @{
    max = @([int]($s.R - 1.5 * $btn), $mid)
    close = @([int]($s.R - 0.5 * $btn), $mid)
    band = @([int]($s.R - 3 * $btn - 260 * $script:scale), $mid)
    body = @([int](($s.L + $s.R) / 2), [int]($s.T + ($s.B - $s.T) * 0.6))
    # the docked sidebar under its few rows, above Open file: nothing there to
    # press on Home or in the editor (Home's own bottom holds Continue once a
    # diagram has been edited)
    quiet = @([int]($s.L + 124 * $script:scale), [int]($s.B - 96 * $script:scale))
  }
}

function Menus() { return [W]::CountClass('#32768') }

function Bridge($method, $path, $body) {
  try {
    $request = @{ UseBasicParsing = $true; Method = $method; Uri = "http://127.0.0.1:4517$path"; TimeoutSec = 10 }
    if ($body) { $request.ContentType = 'application/json'; $request.Body = [System.Text.Encoding]::UTF8.GetBytes($body) }
    $r = Invoke-WebRequest @request
    return @{ status = $r.StatusCode; body = [System.Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()) }
  } catch { return @{ status = -1; body = $_.Exception.Message } }
}

# the spot sits over Maximize: the middle caption button, the band's height
# (below the top resize edge while the window is restored)
function Px($logical) { [int][Math]::Round($logical * $script:scale, [MidpointRounding]::AwayFromZero) }
function CheckSpot($s, $what) {
  $btn = Px $CAPTION_BUTTON
  $band = Px $CHROME_HEIGHT
  # restored, the window's top resize edge (4 px) stays above the spot
  $top = if ($s.Zoomed) { $s.T } else { $s.T + (Px 4) }
  $ok = $s.SpotShown -and
    [Math]::Abs($s.SpotL - ($s.R - 2 * $btn)) -le 1 -and
    [Math]::Abs($s.SpotR - ($s.R - $btn)) -le 1 -and
    [Math]::Abs($s.SpotT - $top) -le 1 -and
    [Math]::Abs($s.SpotB - ($s.T + $band)) -le 1
  Check "Snap layouts spot over Maximize ($what)" $ok "spot=$($s.SpotL),$($s.SpotT),$($s.SpotR),$($s.SpotB) client=$(ClientText $s)"
}

function SnapHover($tag) {
  $p = Points (State "snap-$tag")
  [W]::Move($p.max[0] - 6, $p.max[1]); Start-Sleep -Milliseconds 200
  [W]::Move($p.max[0], $p.max[1]); Start-Sleep -Milliseconds 200
  [W]::Move($p.max[0] + 1, $p.max[1]); Start-Sleep -Seconds 3
  Shot "snap-$tag"
  [W]::Move($p.body[0], $p.body[1]); Start-Sleep -Seconds 2
}

# F11 on and off from the window as it is: the client covers the screen (the
# taskbar's strip too) with the spot gone, Alt+Space opens nothing, and F11
# brings back the same window - maximized stays maximized
function FullscreenRound($tag) {
  Focus "F11 $tag"
  $before = State "fs-$tag-before"
  $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  [W]::Tap($VK_F11); Start-Sleep -Milliseconds 800
  Shot "fs-$tag-on"
  $on = WaitState "fs-$tag-on" { param($x) $x.L -eq $screen.Left -and $x.T -eq $screen.Top -and $x.R -eq $screen.Right -and $x.B -eq $screen.Bottom -and -not $x.SpotShown }
  Check "F11 covers the screen ($tag)" ($on.L -eq $screen.Left -and $on.T -eq $screen.Top -and $on.R -eq $screen.Right -and $on.B -eq $screen.Bottom -and -not $on.SpotShown) "client=$(ClientText $on) screen=$($screen.Left),$($screen.Top),$($screen.Right),$($screen.Bottom) spotShown=$($on.SpotShown)"
  [W]::Chord($VK_ALT, $VK_SPACE); Start-Sleep -Seconds 1
  $menus = Menus
  Check "Alt+Space in full screen opens nothing ($tag)" ($menus -eq 0) "popupMenus=$menus"
  if ($menus -gt 0) { [W]::Tap($VK_ESC); Start-Sleep -Milliseconds 300; [W]::Tap($VK_ESC); Start-Sleep -Milliseconds 300 }
  [W]::Tap($VK_F11)
  $off = WaitState "fs-$tag-off" { param($x) (ClientText $x) -eq (ClientText $before) -and $x.Zoomed -eq $before.Zoomed }
  Check "F11 returns to the window ($tag)" ((ClientText $off) -eq (ClientText $before) -and $off.Zoomed -eq $before.Zoomed) "before=$(ClientText $before) zoomed=$($before.Zoomed) after=$(ClientText $off) zoomed=$($off.Zoomed)"
  Shot "fs-$tag-off"
}

# a window by its class and process, for the log
function WindowName($hwnd) {
  $wpid = [uint32]0
  [W]::GetWindowThreadProcessId($hwnd, [ref]$wpid) | Out-Null
  "$([W]::Cls($hwnd)) of $((Get-Process -Id $wpid -ErrorAction SilentlyContinue).Name)"
}

# the app in front with the keyboard: keys go nowhere else. A runner may open
# its Start menu over the app after it starts, or a WSL update prompt at any
# time, so each run of keys starts here - Esc closes what is in front
# (never the app: only while the app is not in front); the Alt tap lets a
# background process hand the foreground over
function Focus($tag) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $front = [W]::GetForegroundWindow() -eq $script:h
  $seen = @()
  while (-not $front -and $sw.Elapsed.TotalSeconds -lt 8) {
    $seen += WindowName ([W]::GetForegroundWindow())
    [W]::Tap($VK_ESC); Start-Sleep -Milliseconds 400
    [W]::Tap($VK_ALT); [W]::SetForegroundWindow($script:h) | Out-Null
    $p = Points (WindowNow)
    [W]::Click($p.quiet[0], $p.quiet[1]); Start-Sleep -Milliseconds 500
    $front = [W]::GetForegroundWindow() -eq $script:h
  }
  Check "the app has the keyboard ($tag)" $front "in front before: $(if ($seen) { ($seen | Select-Object -Unique) -join ', ' } else { 'the app' })"
}

# an executable's icon as Windows hands it out (the large icon, 32 px at 100%):
# how much of its square the drawing spans, from its at-least-half-opaque box
# (an icon that cannot be read is logged and left out, not the end of the run)
function IconSpan($path) {
  if (-not (Test-Path $path)) { return $null }
  try {
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($path)
    $bmp = $icon.ToBitmap()
    $l = $bmp.Width; $t = $bmp.Height; $r = -1; $b = -1
    for ($y = 0; $y -lt $bmp.Height; $y++) {
      for ($x = 0; $x -lt $bmp.Width; $x++) {
        if ($bmp.GetPixel($x, $y).A -ge 128) {
          if ($x -lt $l) { $l = $x }; if ($x -gt $r) { $r = $x }
          if ($y -lt $t) { $t = $y }; if ($y -gt $b) { $b = $y }
        }
      }
    }
    $span = [Math]::Min(($r - $l + 1) / $bmp.Width, ($b - $t + 1) / $bmp.Height)
    $result = [pscustomobject]@{ Span = $span; Text = "$($r - $l + 1)x$($b - $t + 1) of $($bmp.Width)x$($bmp.Height)" }
    $bmp.Dispose(); $icon.Dispose()
    return $result
  } catch {
    Log "icon $path error=$($_.Exception.Message)"
    return $null
  }
}

function Finish() {
  $script:finishing = $true
  $failed = @($checks | Where-Object { -not $_.Ok })
  $os = (Get-CimInstance Win32_OperatingSystem).Caption
  $lines = @("### Windows smoke: $os", "", "| | Check | Detail |", "|---|---|---|")
  foreach ($c in $checks) { $lines += "| $(if ($c.Ok) { 'pass' } else { '**FAIL**' }) | $($c.Name) | $($c.Detail -replace '[|\r\n]+', ' / ') |" }
  $lines += ""
  $lines += "$($checks.Count - $failed.Count) of $($checks.Count) checks passed. Snap layouts, the toast, Settings after F5, the missing browser menus and the app icon beside other apps' (desktop, taskbar, Alt+Tab, Start) are in the screenshots."
  # UTF-8 without a byte order mark, which the job summary would show
  $text = ($lines -join "`n") + "`n"
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText((Join-Path $Out 'checks.md'), $text, $utf8)
  if ($env:GITHUB_STEP_SUMMARY) { [System.IO.File]::AppendAllText($env:GITHUB_STEP_SUMMARY, $text, $utf8) }
  Get-Process Dosik -ErrorAction SilentlyContinue | Stop-Process -Force
  Log "done: $($checks.Count - $failed.Count)/$($checks.Count) passed"
  if ($failed.Count -gt 0) { exit 1 }
  exit 0
}

# ---- the runner
$os = Get-CimInstance Win32_OperatingSystem
Log "os=$($os.Caption) build=$($os.BuildNumber) arch=$env:PROCESSOR_ARCHITECTURE session=$([System.Diagnostics.Process]::GetCurrentProcess().SessionId) interactive=$([Environment]::UserInteractive)"
if ($Width -gt 0) { Log "set screen ${Width}x${Height} result=$([W]::SetResolution($Width, $Height))"; Start-Sleep -Seconds 2 }
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$wa = New-Object W+RECT; [W]::SystemParametersInfo(0x30, 0, [ref]$wa, 0) | Out-Null
Log "screen=$screen workarea=$($wa.L),$($wa.T),$($wa.R),$($wa.B)"
$adv = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced' -ErrorAction SilentlyContinue
$desk = Get-ItemProperty 'HKCU:\Control Panel\Desktop' -ErrorAction SilentlyContinue
Log "snap settings EnableSnapAssistFlyout=$($adv.EnableSnapAssistFlyout) WindowArrangementActive=$($desk.WindowArrangementActive)"
Shot "00-desktop"
# a fresh image may greet the user with a full-screen first sign-in prompt and
# a WSL update prompt over the desktop; neither is part of the app. What still
# covers the app later (its Start menu) Focus closes
Get-Process WWAHost, wsl -ErrorAction SilentlyContinue | ForEach-Object { Log "closing $($_.Name) id=$($_.Id)"; Stop-Process -Id $_.Id -Force }
(New-Object -ComObject Shell.Application).MinimizeAll()
Start-Sleep -Seconds 2
Shot "00b-desktop-clear"

# ---- install for this user, silently
$p = Start-Process $Installer -ArgumentList '/S' -PassThru -Wait
$exe = Join-Path $env:LOCALAPPDATA 'Dosik\Dosik.exe'
Check "silent install" ($p.ExitCode -eq 0 -and (Test-Path $exe)) "exit=$($p.ExitCode) exe=$exe"
$reg = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Dosik' -ErrorAction SilentlyContinue
Check "uninstall entry" ([bool]$reg.InstallLocation -and [bool]$reg.DisplayVersion) "InstallLocation=$($reg.InstallLocation) DisplayVersion=$($reg.DisplayVersion)"
if (-not (Test-Path $exe)) { Finish }

# ---- the app icon: Windows draws app icons edge to edge, so the tile fills
# the icon's square - with the margin of the macOS icon grid it looks smaller
# than its neighbours. Other apps' icons are measured alongside, for the log
$mine = IconSpan $exe
$others = @(
  @("Explorer", "$env:WINDIR\explorer.exe"),
  @("Edge", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"),
  @("Chrome", "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"),
  @("Firefox", "$env:ProgramFiles\Mozilla Firefox\firefox.exe")
) | ForEach-Object { $s = IconSpan $_[1]; if ($s) { "$($_[0]) $($s.Text)" } }
Check "app icon fills its square" ($mine -and $mine.Span -ge 0.95) "Dosik $(if ($mine) { $mine.Text } else { 'none' }); $($others -join ', ')"
$links = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) | ForEach-Object { "$_\Dosik.lnk=$(Test-Path "$_\Dosik.lnk")" }
Log "shortcuts $($links -join ' ')"
(New-Object -ComObject Shell.Application).MinimizeAll()
Start-Sleep -Seconds 2
Shot "00c-desktop-installed"

# ---- first window: where it lands, and whether it changes once shown
$proc = Start-Process $exe -PassThru
$script:h = [IntPtr]::Zero
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalSeconds -lt 60 -and $script:h -eq [IntPtr]::Zero) {
  Start-Sleep -Milliseconds 20
  $script:h = [W]::ProcWindow([uint32]$proc.Id)
}
# what shows is the client: maximizing right after showing moves the outer
# rectangle and the zoomed flag but not the client, so only it is counted
$last = ""; $lastSeen = ""; $shownAt = $null; $changesAfterShown = 0
while ($script:h -ne [IntPtr]::Zero) {
  $vis = [W]::IsWindowVisible($script:h)
  $c = [W]::Client($script:h)
  $seen = "visible=$vis client=$($c.L),$($c.T),$($c.R),$($c.B)"
  $state = "$seen zoomed=$([W]::IsZoomed($script:h)) rect=$([W]::Rect($script:h))"
  if ($state -ne $last) {
    Log "trace t=$([int]$sw.Elapsed.TotalMilliseconds)ms $state"
    $last = $state
  }
  if ($seen -ne $lastSeen) {
    if ($shownAt) { $changesAfterShown++ }
    $lastSeen = $seen
  }
  if ($vis -and -not $shownAt) { $shownAt = $sw.Elapsed.TotalMilliseconds }
  if ($shownAt -and ($sw.Elapsed.TotalMilliseconds - $shownAt) -gt 6000) { break }
  if ($sw.Elapsed.TotalSeconds -gt 90) { break }
  Start-Sleep -Milliseconds 5
}
Check "window shows" ([bool]$shownAt) "hwnd=$($script:h) shownAfter=$([int]$shownAt)ms"
if (-not $shownAt) { Shot "01-no-window"; Finish }
Check "first window does not change once shown" ($changesAfterShown -eq 0) "changes=$changesAfterShown"
Start-Sleep -Seconds 8
$first = State "first"
Shot "01-first"
$script:scale = [W]::GetDpiForWindow($script:h) / 96.0
if ($first.Zoomed) {
  $placed = $first.L -eq $wa.L -and $first.T -eq $wa.T -and $first.R -eq $wa.R -and $first.B -eq $wa.B
} else {
  $placed = [Math]::Abs(($first.L + $first.R) - ($wa.L + $wa.R)) -le 2 -and [Math]::Abs(($first.T + $first.B) - ($wa.T + $wa.B)) -le 2 -and
    $first.L -ge $wa.L -and $first.T -ge $wa.T -and $first.R -le $wa.R -and $first.B -le $wa.B
}
Check "first window placement" $placed "client=$(ClientText $first) zoomed=$($first.Zoomed) workarea=$($wa.L),$($wa.T),$($wa.R),$($wa.B)"
CheckSpot $first "first"

# focus the web view with a click on an empty place of Home - not on the band,
# whose drag (started over IPC on mousedown) can arrive after a quick click
# has ended on an emulated runner and leave the window following the pointer
$pt = Points $first
Focus "start"

# ---- Maximize: the hover colour and Snap layouts (seen), Close's red (seen)
SnapHover "first"
[W]::Move($pt.close[0], $pt.close[1]); Start-Sleep -Seconds 1
Shot "02-close-hover"
[W]::Move($pt.body[0], $pt.body[1]); Start-Sleep -Seconds 2

# ---- the window menu: a right click on the band, Alt+Space - once each
[W]::RightClick($pt.band[0], $pt.band[1]); Start-Sleep -Seconds 2
$open = Menus
Shot "03-band-menu"
[W]::Tap($VK_ESC); Start-Sleep -Seconds 1
$closed = Menus
Check "band right click opens one window menu" ($open -eq 1 -and $closed -eq 0) "open=$open afterEsc=$closed"
[W]::Chord($VK_ALT, $VK_SPACE); Start-Sleep -Seconds 2
$open = Menus
Shot "04-alt-space"
[W]::Tap($VK_ESC); Start-Sleep -Seconds 1
$closed = Menus
Check "Alt+Space opens one window menu" ($open -eq 1 -and $closed -eq 0) "open=$open afterEsc=$closed"
# Esc closes the menu and leaves the window in menu mode, as any Windows title
# bar does; a second Esc ends it, or the next keys go to the menu
[W]::Tap($VK_ESC); Start-Sleep -Milliseconds 500
for ($i = 0; $i -lt 10 -and (Menus) -gt 0; $i++) { [W]::Tap($VK_ESC); Start-Sleep -Milliseconds 300 }
if ((Menus) -gt 0) { Check "window menus close on Esc" $false "popupMenus=$(Menus)" }

# ---- F11 from the first state (the first time: the toast), then from the other
FullscreenRound "first"
$s = State "before-toggle"
$pt = Points $s
[W]::Click($pt.max[0], $pt.max[1])
$other = WaitState "other" { param($x) $x.Zoomed -ne $s.Zoomed }
Check "Maximize switches the window" ($other.Zoomed -ne $s.Zoomed) "zoomed $($s.Zoomed) -> $($other.Zoomed)"
CheckSpot $other "other"
$pt = Points $other
[W]::Move($pt.body[0], $pt.body[1]); Start-Sleep -Seconds 1
FullscreenRound "other"
SnapHover "other"

# ---- browser keys and menus: nothing happens (seen), no developer tools (checked)
Focus "browser keys"
$pt = Points (State "before-keys")
[W]::Chord($VK_CTRL, $VK_F); Start-Sleep -Seconds 2
Shot "05-ctrl-f"
[W]::Tap($VK_ESC); Start-Sleep -Milliseconds 500
[W]::RightClick($pt.body[0], $pt.body[1]); Start-Sleep -Seconds 2
Shot "05b-body-right-click"
[W]::Tap($VK_ESC); Start-Sleep -Milliseconds 500
[W]::Chord($VK_CTRL, $VK_COMMA); Start-Sleep -Seconds 2
Shot "06-settings"
[W]::Tap($VK_F5); Start-Sleep -Seconds 3
[W]::Chord($VK_CTRL, $VK_R); Start-Sleep -Seconds 3
[W]::Tap($VK_F12); Start-Sleep -Seconds 3
# a bundle is built without developer tools: this guards that staying so
$devtools = @([W]::TopLevel() | Where-Object { $_ -match 'DevTools' })
Check "F12 opens no developer tools" ($devtools.Count -eq 0) "windows=$($devtools -join '; ')"
Shot "06b-settings-after-f5-ctrl-r-f12"
[W]::Tap($VK_F11); Start-Sleep -Seconds 2
Shot "06c-fullscreen-with-settings"
[W]::Tap($VK_F11); Start-Sleep -Seconds 3
[W]::Chord($VK_CTRL, $VK_W); Start-Sleep -Seconds 2
Shot "06d-ctrl-w-closed-settings"
Check "Ctrl+W with Settings open keeps the window" ([W]::IsWindow($script:h) -and -not $proc.HasExited) "window=$([W]::IsWindow($script:h))"

# ---- Maximize twice, then a double click on the band
Focus "Maximize"
$s = State "before-max-clicks"
$pt = Points $s
[W]::Click($pt.max[0], $pt.max[1])
$s1 = WaitState "after-max-click-1" { param($x) $x.Zoomed -ne $s.Zoomed }
SnapHover "late"
$pt = Points $s1
[W]::Click($pt.max[0], $pt.max[1])
$s2 = WaitState "after-max-click-2" { param($x) $x.Zoomed -eq $s.Zoomed }
Check "Maximize switches back" ($s1.Zoomed -ne $s.Zoomed -and $s2.Zoomed -eq $s.Zoomed) "zoomed $($s.Zoomed) -> $($s1.Zoomed) -> $($s2.Zoomed)"
$pt = Points $s2
[W]::DoubleClick($pt.band[0], $pt.band[1])
$s3 = WaitState "after-band-double-click" { param($x) $x.Zoomed -ne $s2.Zoomed }
# the other state is the one Maximize gave a moment ago - the same client too;
# a window that came loose by a late drag changes its zoom but not into that
Check "double click on the band switches the window" ($s3.Zoomed -ne $s2.Zoomed -and (ClientText $s3) -eq (ClientText $s1)) "zoomed $($s2.Zoomed) -> $($s3.Zoomed) client=$(ClientText $s3) expected=$(ClientText $s1) window=$($s3.Outer)"
Shot "07-after-band-double-click"
$pt = Points $s3

# ---- the bridge: a diagram with a Korean and an emoji label
$ko = [string]::Join('', [char[]](0xD55C, 0xAE00, 0x20, 0xB77C, 0xBCA8))
$emoji = [char]::ConvertFromUtf32(0x1F680)
$ops = @{ ops = @(
  @{ op = 'new_diagram'; title = 'Windows smoke' },
  @{ op = 'add_node'; node = @{ id = 'a'; label = "$ko $emoji"; x = 0; y = 0 } },
  @{ op = 'add_node'; node = @{ id = 'b'; label = 'Plain label'; x = 300; y = 0; color = 'blue' } },
  @{ op = 'add_edge'; edge = @{ source = 'a'; target = 'b'; label = 'edge' } }
) } | ConvertTo-Json -Depth 6
$res = Bridge 'GET' '/api' $null
Check "bridge answers" ($res.status -eq 200) "status=$($res.status)"
$sent = [System.Diagnostics.Stopwatch]::StartNew()
$res = Bridge 'POST' '/api/ops' $ops
$took = "$([int]$sent.Elapsed.TotalMilliseconds) ms"
$applied = $res.status -eq 200 -and $res.body -match '"ok"\s*:\s*true' -and $res.body -match '"applied"\s*:\s*4'
# the bridge answers 202 "queued" when the window takes longer than 3 s (a
# busy runner under emulation): then it counts once the diagram shows them
if (-not $applied -and $res.status -eq 202 -and $res.body -match '"queued"\s*:\s*true') {
  $late = [System.Diagnostics.Stopwatch]::StartNew()
  while ($late.Elapsed.TotalSeconds -lt 10) {
    $now = Bridge 'GET' '/api/diagram' $null
    if (([regex]::Matches($now.body, '"id"\s*:\s*"[ab]"')).Count -eq 2) { $applied = $true; break }
    Start-Sleep -Milliseconds 500
  }
  $took = "$took, queued, in the diagram $([int]$late.Elapsed.TotalMilliseconds) ms later"
}
Check "bridge applies ops" $applied "status=$($res.status) took=$took body=$($res.body)"
Start-Sleep -Seconds 3
Shot "08-diagram"
$res = Bridge 'GET' '/api/diagram' $null
$nodes = ([regex]::Matches($res.body, '"id"\s*:\s*"[ab]"')).Count
Check "diagram keeps the Korean label" ($res.status -eq 200 -and $res.body.Contains($ko) -and $nodes -eq 2) "status=$($res.status) nodes=$nodes"

# ---- Settings > Integrations > Claude Desktop: one Install writes Dosik into
# Claude Desktop's config, and the server it names answers. Claude Desktop (its
# MSIX build, from Anthropic's own address) is installed and opened once, so it
# makes its data folder; a runner where that fails skips these checks
$claudeData = Join-Path $env:LOCALAPPDATA 'Claude-Data\claude_pzs8sxrjxfjjc'
$claudeConfig = Join-Path $claudeData 'claude_desktop_config.json'
# a runner may put its WSL update prompt (a terminal window) in front at any
# time - Claude Desktop's first start set it off once - and keys sent then go
# into it, so it is closed first and the app is made sure of before each run of keys
function QuietRunner {
  # only on a hosted runner: on a person's machine these are their own terminals
  if (-not $env:GITHUB_ACTIONS) { return }
  Get-Process wsl, wslhost, WindowsTerminal, OpenConsole -ErrorAction SilentlyContinue | ForEach-Object {
    Log "closing $($_.Name) id=$($_.Id)"; Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
  }
}
$claudeReady = $false
try {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $msix = Join-Path $env:TEMP 'Claude.msix'
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest "https://claude.ai/api/desktop/win32/$arch/msix/latest/redirect" -OutFile $msix -UseBasicParsing -TimeoutSec 300
  $sig = Get-AuthenticodeSignature $msix
  if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'Anthropic') { throw "signature $($sig.Status) $($sig.SignerCertificate.Subject)" }
  Add-AppxPackage -Path $msix -ErrorAction Stop
  $claudePkg = Get-AppxPackage -Name Claude | Select-Object -First 1
  Log "claude desktop $($claudePkg.Version) installed"
  Start-Process "shell:AppsFolder\$($claudePkg.PackageFamilyName)!Claude"
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while (-not (Test-Path $claudeData) -and $sw.Elapsed.TotalSeconds -lt 90) { Start-Sleep -Seconds 2 }
  Start-Sleep -Seconds 5
  Get-Process claude -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
  # the package's own Windows service outlives the app and keeps waking WSL on a runner
  Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object { $_.PathName -match 'WindowsApps\\Claude_' } | ForEach-Object {
    Log "stopping service $($_.Name)"; Stop-Service -Name $_.Name -Force -ErrorAction SilentlyContinue
  }
  Get-Process cowork-svc -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  QuietRunner
  $claudeReady = Test-Path $claudeData
  Log "claude data folder after $([int]$sw.Elapsed.TotalSeconds) s: $claudeReady"
} catch { Log "claude desktop could not be installed: $($_.Exception.Message)" }

# the MCP server a config entry names, asked for its tools over stdio
function McpTools($command, $arguments) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo $command
  $psi.Arguments = ($arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
  $psi.UseShellExecute = $false
  # stderr (the server's notes) is left to the console: a pipe nobody reads could fill and stall it
  $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $false
  $server = [System.Diagnostics.Process]::Start($psi)
  # UTF-8 without a byte order mark: one before the first message would break it
  $in = New-Object System.IO.StreamWriter($server.StandardInput.BaseStream, (New-Object System.Text.UTF8Encoding $false))
  $in.NewLine = "`n"
  $in.WriteLine('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}')
  $in.WriteLine('{"jsonrpc":"2.0","method":"notifications/initialized"}')
  $in.WriteLine('{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
  $in.Flush()
  $answer = ''
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt 30) {
    $line = $server.StandardOutput.ReadLineAsync()
    if (-not $line.Wait(30000)) { break }
    if ($null -eq $line.Result) { break }
    if ($line.Result -match '"id"\s*:\s*2') { $answer = $line.Result; break }
  }
  if (-not $server.HasExited) { $server.Kill() }
  return $answer
}

function AppInFront { return [W]::GetForegroundWindow() -eq $script:h }
function ReadEntry {
  try { return (Get-Content $claudeConfig -Raw -ErrorAction Stop | ConvertFrom-Json).mcpServers.dosik } catch { return $null }
}

if ($claudeReady) {
  # while keys go to the app, a watcher keeps closing what the runner puts over it
  $guard = if ($env:GITHUB_ACTIONS) {
    Start-Job { while ($true) { Get-Process wsl, wslhost, WindowsTerminal, OpenConsole -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 300 } }
  }
  $entry = $null
  for ($attempt = 1; $attempt -le 3 -and -not $entry; $attempt++) {
    QuietRunner; Start-Sleep -Seconds 3
    Focus "Settings > Integrations ($attempt)"
    [W]::Chord($VK_CTRL, $VK_COMMA); Start-Sleep -Seconds 2
    # the dialog has the focus: General, AI assistant, Integrations, Enter
    for ($i = 0; $i -lt 3; $i++) { [W]::Tap(0x09); Start-Sleep -Milliseconds 300 }
    if (-not (AppInFront)) { Log "attempt $attempt - $(WindowName ([W]::GetForegroundWindow())) took the keys"; [W]::Tap($VK_ESC); continue }
    [W]::Tap(0x0D); Start-Sleep -Seconds 4
    Shot "11-integrations"
    # then About, Close, and the first row's button that can be pressed - Claude
    # Desktop's (Claude Code is not on the runner, so its Install is off)
    for ($i = 0; $i -lt 3; $i++) { [W]::Tap(0x09); Start-Sleep -Milliseconds 300 }
    if (-not (AppInFront)) { Log "attempt $attempt - $(WindowName ([W]::GetForegroundWindow())) took the keys"; [W]::Tap($VK_ESC); continue }
    [W]::Tap(0x0D)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt 20 -and -not $entry) { Start-Sleep -Seconds 1; $entry = ReadEntry }
    Shot "11b-after-install-$attempt"
    # not written: close Settings and try the whole run of keys once more
    if (-not $entry) { Log "attempt $attempt - no entry"; QuietRunner; [W]::SetForegroundWindow($script:h) | Out-Null; [W]::Tap($VK_ESC); Start-Sleep -Seconds 1 }
  }
  Start-Sleep -Seconds 2
  Shot "12-integrations-claude-desktop-installed"
  $serverPath = Join-Path $env:APPDATA 'app.dosik.desktop\mcp\server\server.mjs'
  $registered = $entry -and (Test-Path $entry.command) -and @($entry.args).Count -eq 1 -and $entry.args[0] -eq $serverPath
  Check "Install writes Dosik into Claude Desktop's config" $registered "config=$claudeConfig command=$($entry.command) args=$(@($entry.args) -join ' ')"
  if ($registered) {
    $tools = McpTools $entry.command @($entry.args)
    Check "the server Claude Desktop starts answers with Dosik's tools" ($tools -match '"get_diagram"' -and $tools -match '"list_projects"') "answer=$($tools.Substring(0, [Math]::Min(160, $tools.Length)))"
    # the button is Remove now and keeps the focus; it takes a press only once
    # the row has read its facts again (slow under emulation), so a press that
    # went nowhere is tried again
    $gone = $false
    for ($try = 1; $try -le 3 -and -not $gone; $try++) {
      if (-not (AppInFront)) { Log "remove press $try - $(WindowName ([W]::GetForegroundWindow())) in front"; QuietRunner; [W]::SetForegroundWindow($script:h) | Out-Null; Start-Sleep -Seconds 1 }
      [W]::Tap(0x0D)
      $sw = [System.Diagnostics.Stopwatch]::StartNew()
      while ($sw.Elapsed.TotalSeconds -lt 15 -and -not $gone) {
        Start-Sleep -Seconds 1
        $gone = $null -eq (ReadEntry) -and (Test-Path $claudeConfig)
      }
      Log "remove press $try gone=$gone"
    }
    Start-Sleep -Seconds 2
    Shot "13-integrations-claude-desktop-removed"
    Check "Remove takes Dosik out of Claude Desktop's config" $gone "config=$(Get-Content $claudeConfig -Raw -ErrorAction SilentlyContinue)"
  }
  [W]::Tap($VK_ESC); Start-Sleep -Seconds 1
  if ($guard) { Stop-Job $guard -ErrorAction SilentlyContinue; Remove-Job $guard -Force -ErrorAction SilentlyContinue }
} else {
  Check "Claude Desktop checks (skipped: Claude Desktop could not be installed on this runner)" $true "see log.txt"
}

# ---- Alt+Tab (seen): the switcher with the app's icon over its window; Esc
# before Alt goes up leaves it without switching. The window saw Alt go down
# and up with nothing between, so it may be left in menu mode: one more Esc
Focus "Alt+Tab"
[W]::Key($VK_ALT, $false); Start-Sleep -Milliseconds 100
[W]::Tap($VK_TAB); Start-Sleep -Seconds 2
Shot "08b-alt-tab"
[W]::Tap($VK_ESC); Start-Sleep -Milliseconds 100
[W]::Key($VK_ALT, $true); Start-Sleep -Milliseconds 500
[W]::Tap($VK_ESC); Start-Sleep -Milliseconds 500

# ---- Ctrl+W: the tab, then on Home the window - the app quits
[W]::Click($pt.body[0], $pt.body[1]); Start-Sleep -Milliseconds 500
Focus "Ctrl+W"
[W]::Chord($VK_CTRL, $VK_W); Start-Sleep -Seconds 2
Shot "09-ctrl-w-tab"
$res = Bridge 'GET' '/api/diagram' $null
Check "Ctrl+W closes the tab" ($res.status -eq 200 -and $res.body -match '"nodes"\s*:\s*\[\s*\]' -and -not $res.body.Contains($ko)) "body=$($res.body.Substring(0, [Math]::Min(120, $res.body.Length)))"
# a runner window can come up between the two (the WSL update prompt did)
Focus "Ctrl+W on Home"
[W]::Chord($VK_CTRL, $VK_W)
# closing saves first and lets WebView2 go: up to 15 s, under emulation too
$exited = $proc.WaitForExit(15000)
Check "Ctrl+W on Home quits" (-not [W]::IsWindow($script:h) -and $exited) "window=$([W]::IsWindow($script:h)) exited=$exited"
Shot "10-ctrl-w-home"

# ---- Start (seen): the app among the recent ones, then found by name. A
# runner may have opened Start on its own, which the Win key would close
[W]::Tap($VK_ESC); Start-Sleep -Milliseconds 500
[W]::Tap($VK_WIN); Start-Sleep -Seconds 3
Shot "11-start"
foreach ($vk in @(0x44, 0x4F, 0x53, 0x49, 0x4B)) { [W]::Tap($vk); Start-Sleep -Milliseconds 150 }
Start-Sleep -Seconds 4
Shot "12-start-search"
[W]::Tap($VK_ESC); Start-Sleep -Milliseconds 500
[W]::Tap($VK_ESC)

Finish
