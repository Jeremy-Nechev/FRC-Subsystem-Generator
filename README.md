# FRC subsystem generator

Generates the four-file TalonFX subsystem scaffold NOMAD uses — `X.java`,
`XIO.java`, `XIOTalonFX.java`, `XIOSimTalonFX.java` — from a form, plus
paste-in snippets for `RobotVisualizer.java`.

The output is a **starting point**, not something to regenerate over. Generate
once, paste into the robot project, then hand-edit. Custom behaviour (agitation
sweeps, interlocks, real state machines) is written by hand afterwards.

## Running locally

```bash
npm install
npm run dev
```

## What it generates

Every subsystem is a list of **mechanisms**. Each mechanism is one of three
archetypes, which picks the sim model and the unit it is commanded in:

| Archetype | Unit | Sim model | Control requests |
| --- | --- | --- | --- |
| Roller / flywheel | RPM | `FlywheelSim` | `VelocityVoltage`, `VoltageOut` |
| Arm | degrees | `SingleJointedArmSim` | `MotionMagicVoltage`, `PositionVoltage` |
| Elevator / extension | meters | `ElevatorSim` | `MotionMagicVoltage`, `PositionVoltage` |

All control requests are built with `.withEnableFOC(true)`.

Naming follows the mechanism name: `roller` produces `rollerVelocityRPM`,
`setRollerVelocity(...)`, `kRollerP`, `m_rollerLeadMotor`. Subsystems with a
single mechanism can drop that prefix (matching the existing `Flywheel` and
`Hood` style) via the checkbox in section 1.

## States

The generator always emits a fixed `IDLE / TEST_FORWARD / TEST_REVERSE` enum so
a new mechanism can be driven on the bench immediately:

- velocity and voltage mechanisms: zero, then `±` the test constant
- positional mechanisms: min, then max, then min

Replace the enum and the `resolve*` switch arms with the real states once
bring-up passes.

## Assumptions baked in

Output targets this robot project specifically:

- `Constants.CANBuses.UpperBus` / `LowerBus`
- `CtreUtil.reportIfNotOk` and `CtreUtil.configureKrakenX60Sim` / `X44Sim`
- `RobotVisualizer` for the `Mechanism2d` and AdvantageScope component poses

## Design

Dark theme only. The accent is `#69882c`; because that green only reaches
about 4:1 against the dark surfaces, text uses a lighter tint of the same hue
(`--accent-text`) while `#69882c` itself carries borders, focus rings and
fills.

Two typefaces:

| Role | Font | Used for |
| --- | --- | --- |
| Display | Kabel | headings — geometric, low x-height, poor below ~14px |
| Text | Akzidenz-Grotesk | everything else: labels, inputs, buttons |

Both are licensed, so the files are **not** in this repo and the stacks
currently fall back to Futura / Century Gothic and Helvetica respectively. To
use the real faces, drop the `.woff2` files into `src/fonts/` and uncomment the
`@font-face` blocks at the top of `src/index.css`. Keeping them under `src/`
rather than `public/` lets Vite hash them and rewrite the URLs for whatever
base path Pages serves from.

The generated-code pane stays monospaced regardless — Java indentation only
reads correctly in a fixed-width face.

## Deploying

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`. Enable Pages with source "GitHub Actions" in
the repo settings. `vite.config.ts` sets `base` to `/FRC-Subsystem-Generator/`
under CI — rename it there if the repo is named something else.
