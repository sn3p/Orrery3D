const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { serve } = require("./server.cjs");

async function main() {
  const { server, url } = await serve();
  let context, profile;
  try {
    const output = path.resolve(process.env.OUTPUT || ".context/benchmark/results.json");
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const headless = process.env.HEADLESS === "1";
    const launch = { headless };
    if (process.env.BROWSER_PATH) launch.executablePath = process.env.BROWSER_PATH;
    else launch.channel = "chrome";
    profile = fs.mkdtempSync(path.join(os.tmpdir(), "orrery3d-benchmark-"));
    const energySaver = process.env.ENERGY_SAVER === "default" ? "browser-default" : "disabled";
    if (energySaver === "disabled") {
      // Only the disposable benchmark profile: never the user's browser settings.
      fs.writeFileSync(path.join(profile, "Local State"), JSON.stringify({
        performance_tuning: { battery_saver_mode: { state: 0 } },
      }));
    }
    context = await chromium.launchPersistentContext(profile, {
      ...launch,
      viewport: { width: Number(process.env.WIDTH || 1280), height: Number(process.env.HEIGHT || 800) },
      deviceScaleFactor: Number(process.env.DPR || 1),
    });
    const page = context.pages()[0] || await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(url); await page.evaluate(() => window.benchmark.ready); await page.bringToFront();
    const report = {
      timestamp: new Date().toISOString(),
      workingTree: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      harnessSha256: Object.fromEntries(["browser.js", "run.cjs", "server.cjs", "index.html", "../package-lock.json", "../src/js/Asteroids.js", "../src/js/prepareCatalogue.js", "../src/js/constants.js", "../src/js/Orrery3D.js", "../src/js/PlaybackClock.js"].map(file => [file,
        crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, file))).digest("hex")
      ])),
      catalogueSha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, "../data/catalog.json"))).digest("hex"),
      browserVersion: context.browser().version(), headless, energySaver,
      battery: await page.evaluate(async () => {
        if (!navigator.getBattery) return null;
        const battery = await navigator.getBattery();
        return { charging: battery.charging, level: battery.level };
      }),
      environment: await page.evaluate(() => window.benchmark.environment()),
      results: [], errors,
    };
    console.log(JSON.stringify(report.environment));
    if (/swiftshader|llvmpipe|software/i.test(report.environment.gpu) && process.env.ALLOW_SOFTWARE !== "1") {
      throw new Error("Software rendering detected; refusing to report hardware GPU FPS.");
    }
    const counts = (process.env.COUNTS || "10000,100000,500000,1000000").split(",").map(Number);
    const repetitions = Number(process.env.REPETITIONS || 3);
    if (!Number.isSafeInteger(repetitions) || repetitions < 1) throw new Error("REPETITIONS must be a positive integer.");
    for (let repeat = 0; repeat < repetitions; repeat++) {
      // Reverse count order between repetitions to reduce systematic ordering bias.
      for (const count of repeat % 2 ? [...counts].reverse() : counts) {
        const options = {
          count, repeat, dpr: Number(process.env.DPR || 1), camera: process.env.CAMERA || "overview",
          frames: Number(process.env.FRAMES || 120), warmup: Number(process.env.WARMUP || 30),
          step: Number(process.env.STEP || 1.5), startJed: Number(process.env.JED || 2458600.5),
        };
        const result = await page.evaluate(options => window.benchmark.measure(options), options);
        report.results.push(result);
        fs.writeFileSync(output, JSON.stringify(report, null, 2));
        const { samples, ...summary } = result;
        console.log(JSON.stringify(summary));
      }
    }
    const preview = await page.evaluate(options => window.benchmark.preview(options), {
      count: counts[counts.length - 1], dpr: Number(process.env.DPR || 1), camera: process.env.CAMERA || "overview",
      startJed: Number(process.env.JED || 2458600.5), capture: true,
    });
    fs.writeFileSync(path.join(path.dirname(output), path.parse(output).name + "-gpu.png"), Buffer.from(preview.image.split(",")[1], "base64"));
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    if (errors.length) throw new Error(`Browser errors: ${errors.join("\n")}`);
    console.log(`Saved ${output}`);
  } finally {
    await context?.close();
    if (profile) fs.rmSync(profile, { recursive: true, force: true });
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
