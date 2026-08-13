import type { MechanismConfig, SubsystemConfig } from './types';
import { ARCHETYPES, TEST_STATES } from './types';
import { normalizeConfig } from './defaults';
import {
  assign,
  cap,
  connectedField,
  constant,
  d,
  dcMotorCall,
  field,
  followerMotor,
  followerVoltageSignal,
  leadMotor,
  measureField,
  method,
  motorFields,
  motorIdConstants,
  quantity,
  simConfigureCall,
  simField,
} from './naming';

export interface GeneratedFile {
  name: string;
  contents: string;
}

const pkg = (config: SubsystemConfig) =>
  `${config.packageRoot}.${config.name.toLowerCase()}`;

const isPositional = (mech: MechanismConfig) => ARCHETYPES[mech.archetype].positional;
const usesMotionMagic = (mech: MechanismConfig) => mech.control === 'MotionMagicVoltage';
const usesGains = (mech: MechanismConfig) => mech.control !== 'VoltageOut';

/** The parameter name and unit for a mechanism's setter. */
function setterParam(mech: MechanismConfig): string {
  switch (quantity(mech)) {
    case 'voltage':
      return 'volts';
    case 'velocity':
      return 'velocityRPM';
    default:
      return mech.archetype === 'arm' ? 'positionDegrees' : 'positionMeters';
  }
}

function setterName(config: SubsystemConfig, mech: MechanismConfig): string {
  const q = quantity(mech);
  const noun = q === 'voltage' ? 'Voltage' : q === 'velocity' ? 'Velocity' : 'Position';
  return method(config, mech, 'set', noun);
}

const requestField = (mech: MechanismConfig) => `m_${mech.name}Request`;

function requestInit(mech: MechanismConfig): string {
  switch (mech.control) {
    case 'VelocityVoltage':
      return `new VelocityVoltage(0.0).withEnableFOC(true)`;
    case 'VoltageOut':
      return `new VoltageOut(0.0).withEnableFOC(true)`;
    case 'PositionVoltage':
      return `new PositionVoltage(0.0).withEnableFOC(true)`;
    case 'MotionMagicVoltage':
      return `new MotionMagicVoltage(0.0).withEnableFOC(true)`;
  }
}

// ---------------------------------------------------------------- constants

function mechanismConstants(config: SubsystemConfig, mech: MechanismConfig): string {
  const c = (s: string) => constant(config, mech, s);
  const lines: string[] = [];
  const title = cap(mech.name);

  lines.push(`// ${title} motor ids`);
  motorIdConstants(mech).forEach((name, i) => {
    lines.push(`public static final int ${name} = ${mech.motors[i].canId};`);
  });
  lines.push('');

  if (usesGains(mech)) {
    lines.push(`// ${title} gains`);
    lines.push(`public static final double ${c('P')} = ${d(mech.kP)};`);
    if (mech.kD !== 0) {
      lines.push(`public static final double ${c('D')} = ${d(mech.kD)};`);
    }
    lines.push(`public static final double ${c('S')} = ${d(mech.kS)};`);
    lines.push(`public static final double ${c('V')} = ${d(mech.kV)};`);
    if (mech.kA !== 0) {
      lines.push(`public static final double ${c('A')} = ${d(mech.kA)};`);
    }
    if (isPositional(mech) && mech.simulateGravity) {
      lines.push(`public static final double ${c('G')} = ${d(mech.kG)};`);
    }
    lines.push('');
  }

  lines.push(`// ${title} configuration`);
  lines.push(
    `public static final double ${c('StatorCurrentLimit')} = ${d(mech.statorCurrentLimit)};`,
  );
  lines.push(
    `public static final double ${c('SupplyCurrentLimit')} = ${d(mech.supplyCurrentLimit)};`,
  );
  lines.push(`public static final double ${c('Reduction')} = ${d(mech.reduction)};`);

  if (mech.archetype === 'roller') {
    lines.push(`public static final double ${c('MOI')} = ${d(mech.moi)}; // kg m^2`);
  }

  if (isPositional(mech)) {
    const unit = mech.archetype === 'arm' ? 'Degrees' : 'Meters';
    lines.push(`public static final double ${c(`Min${unit}`)} = ${d(mech.minPosition)};`);
    lines.push(`public static final double ${c(`Max${unit}`)} = ${d(mech.maxPosition)};`);
  }

  if (usesMotionMagic(mech)) {
    lines.push(
      `public static final double ${c('CruiseVelocity')} = ${d(mech.cruiseVelocity)};`,
    );
    lines.push(`public static final double ${c('Acceleration')} = ${d(mech.acceleration)};`);
  }

  if (mech.archetype === 'arm') {
    lines.push(`public static final double ${c('MOI')} = ${d(mech.moi)}; // kg m^2`);
    lines.push(`public static final double ${c('LengthMeters')} = ${d(mech.armLengthMeters)};`);
  }

  if (mech.archetype === 'elevator') {
    lines.push(
      `public static final double ${c('DrumRadiusMeters')} = ${d(mech.drumRadiusMeters)};`,
    );
    lines.push(
      `public static final double ${c('DrumCircumferenceMeters')} =\n        2.0 * Math.PI * ${c('DrumRadiusMeters')};`,
    );
    lines.push(`public static final double ${c('CarriageMassKg')} = ${d(mech.carriageMassKg)};`);
  }

  // Positional mechanisms sweep between their existing min/max, so they need
  // no extra test constant.
  if (quantity(mech) === 'voltage') {
    lines.push('');
    lines.push(`// ${title} bring-up test values`);
    lines.push(`public static final double ${c('TestVolts')} = ${d(mech.testVolts)};`);
  } else if (quantity(mech) === 'velocity') {
    lines.push('');
    lines.push(`// ${title} bring-up test values`);
    lines.push(
      `public static final double ${c('TestVelocityRPM')} = ${d(mech.testVelocityRPM)};`,
    );
  }

  return lines.join('\n');
}

// ------------------------------------------------------------- target logic

/** The constant or literal a mechanism is commanded to in each test state. */
function targetFor(
  config: SubsystemConfig,
  mech: MechanismConfig,
  state: (typeof TEST_STATES)[number],
): string {
  const c = (s: string) => `${config.name}Constants.${constant(config, mech, s)}`;
  const q = quantity(mech);

  if (q === 'voltage') {
    if (state === 'IDLE') return '0.0';
    return state === 'TEST_FORWARD' ? c('TestVolts') : `-${c('TestVolts')}`;
  }
  if (q === 'velocity') {
    if (state === 'IDLE') return '0.0';
    return state === 'TEST_FORWARD' ? c('TestVelocityRPM') : `-${c('TestVelocityRPM')}`;
  }
  const unit = mech.archetype === 'arm' ? 'Degrees' : 'Meters';
  return state === 'TEST_FORWARD' ? c(`Max${unit}`) : c(`Min${unit}`);
}

function resolverName(mech: MechanismConfig): string {
  const q = quantity(mech);
  const noun = q === 'voltage' ? 'Voltage' : q === 'velocity' ? 'Velocity' : 'Position';
  return `resolve${cap(mech.name)}Target${noun}`;
}

function resolver(config: SubsystemConfig, mech: MechanismConfig): string {
  const arms = TEST_STATES.map(
    (s) => `            case ${s} -> ${targetFor(config, mech, s)};`,
  ).join('\n');
  return [
    `    private static double ${resolverName(mech)}(${config.name}State state) {`,
    `        return switch (state) {`,
    arms,
    `        };`,
    `    }`,
  ].join('\n');
}

// ------------------------------------------------------------------ XIO.java

function generateIO(config: SubsystemConfig): GeneratedFile {
  const { name } = config;
  const anyPositional = config.mechanisms.some(isPositional);
  const stoppable = config.mechanisms.filter((m) => !isPositional(m));

  const setters = config.mechanisms
    .map(
      (m) =>
        `    default void ${setterName(config, m)}(double ${setterParam(m)}) {}`,
    )
    .join('\n\n');

  const stopBody = stoppable
    .map((m) => `        ${setterName(config, m)}(0.0);`)
    .join('\n');

  const inputs = config.mechanisms
    .map((m) => {
      const lines: string[] = [];
      lines.push(`        public double ${measureField(config, m)};`);
      lines.push(`        public double ${field(config, m, 'appliedVolts')};`);
      lines.push(`        public double ${field(config, m, 'statorCurrentAmps')};`);
      lines.push(`        public double ${field(config, m, 'supplyCurrentAmps')};`);
      m.motors.forEach((_, i) => {
        lines.push(`        public boolean ${connectedField(config, m, i)};`);
      });
      return lines.join('\n');
    })
    .join('\n\n');

  const contents = `package ${pkg(config)};

public interface ${name}IO {

    default void updateInputs(${name}Inputs inputs) {}

${setters}
${anyPositional ? '\n    default void resetEncoder() {}\n' : ''}
    default void stop() {
${stopBody || '        // no open-loop mechanisms to zero'}
    }

    class ${name}Inputs {

${inputs}
    }
}
`;
  return { name: `${name}IO.java`, contents };
}

// -------------------------------------------------------------- X.java

function generateSubsystem(config: SubsystemConfig): GeneratedFile {
  const { name, visualizer: viz } = config;
  const anyPositional = config.mechanisms.some(isPositional);
  const driven = config.mechanisms.find((m) => m.name === viz.drivenBy);
  const vizIsArm = driven?.archetype === 'arm';
  const viz2d = viz.enabled && viz.mechanism2d;
  // A 3D pose only means something for a mechanism that moves in space.
  const viz3d =
    viz.enabled && viz.advantageScope3d && !!driven && isPositional(driven);

  const imports = [
    'edu.wpi.first.wpilibj2.command.SubsystemBase',
    ...(viz2d || viz3d ? ['frc.robot.RobotVisualizer'] : []),
    ...(viz2d || (viz3d && vizIsArm) ? ['edu.wpi.first.math.util.Units'] : []),
    ...(viz2d
      ? [
          'edu.wpi.first.wpilibj.smartdashboard.MechanismLigament2d',
          'edu.wpi.first.wpilibj.util.Color8Bit',
        ]
      : []),
  ]
    .sort()
    .map((i) => `import ${i};`)
    .join('\n');

  const constants = config.mechanisms
    .map((m) => mechanismConstants(config, m))
    .join('\n\n')
    .split('\n')
    .map((l) => (l.trim() === '' ? '' : `        ${l}`))
    .join('\n');

  const getters = config.mechanisms
    .flatMap((m) => {
      const g: string[] = [];
      g.push(
        `    public double get${cap(measureField(config, m))}() {\n        return inputs.${measureField(config, m)};\n    }`,
      );
      g.push(
        `    public double get${cap(field(config, m, 'appliedVolts'))}() {\n        return inputs.${field(config, m, 'appliedVolts')};\n    }`,
      );
      const connChecks = m.motors
        .map((_, i) => `inputs.${connectedField(config, m, i)}`)
        .join('\n                && ');
      g.push(
        `    public boolean ${m.motors.length === 1 ? 'is' : 'are'}${cap(m.name)}Motor${m.motors.length === 1 ? '' : 's'}Connected() {\n        return ${connChecks};\n    }`,
      );
      return g;
    })
    .join('\n\n');

  const requests = TEST_STATES.map(
    (s) =>
      `    public void request${s
        .split('_')
        .map((p) => cap(p.toLowerCase()))
        .join('')}() {\n        setState(${name}State.${s});\n    }`,
  ).join('\n\n');

  const periodicCalls = config.mechanisms
    .map((m) => `        io.${setterName(config, m)}(${resolverName(m)}(state));`)
    .join('\n');

  const resolvers = config.mechanisms.map((m) => resolver(config, m)).join('\n\n');

  const ligament = viz2d
    ? `
    private final MechanismLigament2d ${name.toLowerCase()}Ligament = new MechanismLigament2d(
            "${name.toLowerCase()}",
            Units.inchesToMeters(${d(viz.ligamentLengthInches)}),
            ${d(viz.ligamentAngleDegrees)},
            ${d(viz.ligamentWidth)},
            new Color8Bit(${viz.color}));
`
    : '';

  const update2d =
    viz2d && driven
      ? vizIsArm
        ? `        ${name.toLowerCase()}Ligament.setAngle(inputs.${measureField(config, driven)});\n`
        : `        ${name.toLowerCase()}Ligament.setLength(\n                Units.inchesToMeters(${d(viz.ligamentLengthInches)}) + inputs.${measureField(config, driven)});\n`
      : '';

  const update3d =
    viz3d && driven
      ? vizIsArm
        ? `        RobotVisualizer.update${name}(\n                Units.degreesToRadians(inputs.${measureField(config, driven)}));\n`
        : `        RobotVisualizer.update${name}(inputs.${measureField(config, driven)});\n`
      : '';

  const vizUpdate = update2d || update3d ? `\n${update2d}${update3d}` : '';

  const contents = `package ${pkg(config)};

${imports}

public class ${name} extends SubsystemBase {

    public static final class ${name}Constants {
${constants}
    }

    /**
     * Bring-up test states. Replace these with the real states for this
     * mechanism once the hardware is verified.
     */
    public enum ${name}State {
${TEST_STATES.map((s) => `        ${s}`).join(',\n')}
    }

    private final ${name}IO io;
    private final ${name}IO.${name}Inputs inputs = new ${name}IO.${name}Inputs();

    private ${name}State state = ${name}State.IDLE;
${ligament}
    public ${name}() {
        this(new ${name}IO() {
        });
    }

    public ${name}(${name}IO io) {
        this.io = io;${viz2d ? `\n        RobotVisualizer.add${name}(${name.toLowerCase()}Ligament);` : ''}
    }

    public void setState(${name}State state) {
        this.state = state;
    }

    public ${name}State getState() {
        return state;
    }

    public void stop() {
        state = ${name}State.IDLE;
        io.stop();
    }
${anyPositional ? `\n    public void resetEncoder() {\n        io.resetEncoder();\n    }\n` : ''}
${requests}

${getters}

    @Override
    public void periodic() {
        io.updateInputs(inputs);
${vizUpdate}
${periodicCalls}
    }

${resolvers}
}
`;
  return { name: `${name}.java`, contents };
}

// ------------------------------------------------------- XIOTalonFX.java

function signalFields(mech: MechanismConfig): string {
  const lead = leadMotor(mech);
  const n = mech.name;
  const lines: string[] = [];
  if (isPositional(mech)) {
    lines.push(
      assign(4, `private final StatusSignal<Angle> m_${n}Position`, `${lead}.getPosition()`),
    );
  } else {
    lines.push(
      assign(
        4,
        `private final StatusSignal<AngularVelocity> m_${n}Velocity`,
        `${lead}.getVelocity()`,
      ),
    );
  }
  lines.push(
    assign(
      4,
      `private final StatusSignal<Voltage> m_${n}AppliedVoltage`,
      `${lead}.getMotorVoltage()`,
    ),
  );
  lines.push(
    assign(
      4,
      `private final StatusSignal<Current> m_${n}StatorCurrent`,
      `${lead}.getStatorCurrent()`,
    ),
  );
  lines.push(
    assign(
      4,
      `private final StatusSignal<Current> m_${n}SupplyCurrent`,
      `${lead}.getSupplyCurrent()`,
    ),
  );
  mech.motors.forEach((_, i) => {
    if (i === 0) return;
    lines.push(
      `    private final StatusSignal<Voltage> ${followerVoltageSignal(mech, i)} =\n            ${followerMotor(mech, i)}.getMotorVoltage();`,
    );
  });
  return lines.join('\n');
}

function configureMethod(config: SubsystemConfig, mech: MechanismConfig): string {
  const C = `${config.name}Constants`;
  const c = (s: string) => `${C}.${constant(config, mech, s)}`;
  const cfg = `${mech.name}Config`;
  const lines: string[] = [];

  lines.push(`    private void configure${cap(mech.name)}Motors() {`);
  lines.push(`        TalonFXConfiguration ${cfg} = new TalonFXConfiguration();`);
  lines.push(`        ${cfg}.MotorOutput = new MotorOutputConfigs()`);
  lines.push(`                .withNeutralMode(NeutralModeValue.${mech.neutralMode})`);
  lines.push(`                .withInverted(InvertedValue.${mech.invertLead});`);
  lines.push(`        ${cfg}.CurrentLimits = new CurrentLimitsConfigs()`);
  lines.push(`                .withStatorCurrentLimit(${c('StatorCurrentLimit')})`);
  lines.push(`                .withStatorCurrentLimitEnable(true)`);
  lines.push(`                .withSupplyCurrentLimit(${c('SupplyCurrentLimit')})`);
  lines.push(`                .withSupplyCurrentLimitEnable(true);`);
  lines.push(
    `        ${cfg}.Feedback = new FeedbackConfigs()\n                .withSensorToMechanismRatio(${c('Reduction')});`,
  );

  if (usesGains(mech)) {
    const slot: string[] = [
      `        ${cfg}.Slot0 = new Slot0Configs()`,
      `                .withKP(${c('P')})`,
    ];
    if (mech.kD !== 0) slot.push(`                .withKD(${c('D')})`);
    slot.push(`                .withKS(${c('S')})`);
    slot.push(`                .withKV(${c('V')})`);
    if (mech.kA !== 0) slot.push(`                .withKA(${c('A')})`);
    if (isPositional(mech) && mech.simulateGravity) {
      const gravityType =
        mech.archetype === 'arm' ? 'Arm_Cosine' : 'Elevator_Static';
      slot.push(`                .withKG(${c('G')})`);
      slot.push(`                .withGravityType(GravityTypeValue.${gravityType})`);
    }
    lines.push(slot.join('\n') + ';');
  }

  if (usesMotionMagic(mech)) {
    lines.push(`        ${cfg}.MotionMagic = new MotionMagicConfigs()`);
    lines.push(`                .withMotionMagicCruiseVelocity(${c('CruiseVelocity')})`);
    lines.push(`                .withMotionMagicAcceleration(${c('Acceleration')});`);
  }

  lines.push('');
  lines.push(
    `        CtreUtil.reportIfNotOk(\n                "configure ${mech.name}",\n                ${leadMotor(mech)}.getConfigurator().apply(${cfg}));`,
  );
  mech.motors.forEach((motor, i) => {
    if (i === 0) return;
    lines.push(
      `        CtreUtil.reportIfNotOk(\n                "configure ${mech.name} follower ${i}",\n                ${followerMotor(mech, i)}.getConfigurator().apply(${cfg}));`,
    );
    lines.push(
      `        ${followerMotor(mech, i)}.setControl(\n                new Follower(${leadMotor(mech)}.getDeviceID(), MotorAlignmentValue.${motor.alignment}));`,
    );
  });
  lines.push(`    }`);
  return lines.join('\n');
}

function conversionHelpers(config: SubsystemConfig, mech: MechanismConfig): string {
  const C = `${config.name}Constants`;
  const c = (s: string) => `${C}.${constant(config, mech, s)}`;
  const N = cap(mech.name);

  if (mech.archetype === 'arm') {
    return [
      `    protected static double ${mech.name}DegreesToRotations(double degrees) {`,
      `        return degrees / 360.0;`,
      `    }`,
      ``,
      `    protected static double ${mech.name}RotationsToDegrees(double rotations) {`,
      `        return rotations * 360.0;`,
      `    }`,
    ].join('\n');
  }
  if (mech.archetype === 'elevator') {
    return [
      `    protected static double ${mech.name}MetersToRotations(double meters) {`,
      `        return meters / ${c('DrumCircumferenceMeters')};`,
      `    }`,
      ``,
      `    protected static double ${mech.name}RotationsToMeters(double rotations) {`,
      `        return rotations * ${c('DrumCircumferenceMeters')};`,
      `    }`,
    ].join('\n');
  }
  // Rollers command rotations per second inline; no helper needed.
  void N;
  return '';
}

function generateTalonFX(config: SubsystemConfig): GeneratedFile {
  const { name } = config;
  const C = `${name}Constants`;
  const anyPositional = config.mechanisms.some(isPositional);
  const anyMotionMagic = config.mechanisms.some(usesMotionMagic);
  const anyGains = config.mechanisms.some(usesGains);
  const anyGravity = config.mechanisms.some(
    (m) => isPositional(m) && m.simulateGravity && usesGains(m),
  );
  const anyFollower = config.mechanisms.some((m) => m.motors.length > 1);
  const controls = new Set(config.mechanisms.map((m) => m.control));

  const imports = [
    'com.ctre.phoenix6.BaseStatusSignal',
    'com.ctre.phoenix6.StatusSignal',
    'com.ctre.phoenix6.configs.CurrentLimitsConfigs',
    'com.ctre.phoenix6.configs.FeedbackConfigs',
    ...(anyMotionMagic ? ['com.ctre.phoenix6.configs.MotionMagicConfigs'] : []),
    'com.ctre.phoenix6.configs.MotorOutputConfigs',
    ...(anyGains ? ['com.ctre.phoenix6.configs.Slot0Configs'] : []),
    'com.ctre.phoenix6.configs.TalonFXConfiguration',
    ...(anyFollower ? ['com.ctre.phoenix6.controls.Follower'] : []),
    ...[...controls].sort().map((c) => `com.ctre.phoenix6.controls.${c}`),
    'com.ctre.phoenix6.hardware.TalonFX',
    ...(anyGravity ? ['com.ctre.phoenix6.signals.GravityTypeValue'] : []),
    'com.ctre.phoenix6.signals.InvertedValue',
    ...(anyFollower ? ['com.ctre.phoenix6.signals.MotorAlignmentValue'] : []),
    'com.ctre.phoenix6.signals.NeutralModeValue',
    ...(anyPositional ? ['edu.wpi.first.units.measure.Angle'] : []),
    ...(config.mechanisms.some((m) => !isPositional(m))
      ? ['edu.wpi.first.units.measure.AngularVelocity']
      : []),
    'edu.wpi.first.units.measure.Current',
    'edu.wpi.first.units.measure.Voltage',
    'frc.robot.Constants',
    'frc.robot.util.CtreUtil',
    `${pkg(config)}.${name}.${C}`,
  ]
    .sort()
    .map((i) => `import ${i};`)
    .join('\n');

  const motors = config.mechanisms
    .map((m) =>
      motorFields(m)
        .map(
          (fieldName, i) =>
            `    protected final TalonFX ${fieldName} =\n            new TalonFX(${C}.${motorIdConstants(m)[i]}, Constants.CANBuses.${config.canBus});`,
        )
        .join('\n'),
    )
    .join('\n\n');

  const requests = config.mechanisms
    .map(
      (m) =>
        `    protected final ${m.control} ${requestField(m)} =\n            ${requestInit(m)};`,
    )
    .join('\n');

  const signals = config.mechanisms.map((m) => signalFields(m)).join('\n\n');

  const configureCalls = config.mechanisms
    .map((m) => `        configure${cap(m.name)}Motors();`)
    .join('\n');

  const configureMethods = config.mechanisms
    .map((m) => configureMethod(config, m))
    .join('\n\n');

  const updateBlocks = config.mechanisms
    .map((m) => {
      const n = m.name;
      const measure = isPositional(m) ? `m_${n}Position` : `m_${n}Velocity`;
      const lines: string[] = [];
      lines.push(`        inputs.${connectedField(config, m, 0)} =`);
      lines.push(`                BaseStatusSignal.refreshAll(`);
      lines.push(`                        ${measure},`);
      lines.push(`                        m_${n}AppliedVoltage,`);
      lines.push(`                        m_${n}StatorCurrent,`);
      lines.push(`                        m_${n}SupplyCurrent)`);
      lines.push(`                        .isOK();`);
      m.motors.forEach((_, i) => {
        if (i === 0) return;
        lines.push(`        inputs.${connectedField(config, m, i)} =`);
        lines.push(
          `                BaseStatusSignal.refreshAll(${followerVoltageSignal(m, i)}).isOK();`,
        );
      });
      lines.push('');
      const value = isPositional(m)
        ? m.archetype === 'arm'
          ? `${n}RotationsToDegrees(m_${n}Position.getValueAsDouble())`
          : `${n}RotationsToMeters(m_${n}Position.getValueAsDouble())`
        : `m_${n}Velocity.getValueAsDouble() * 60.0`;
      lines.push(
        isPositional(m)
          ? `        inputs.${measureField(config, m)} =\n                ${value};`
          : `        inputs.${measureField(config, m)} = ${value};`,
      );
      lines.push(
        `        inputs.${field(config, m, 'appliedVolts')} = m_${n}AppliedVoltage.getValueAsDouble();`,
      );
      lines.push(
        `        inputs.${field(config, m, 'statorCurrentAmps')} = m_${n}StatorCurrent.getValueAsDouble();`,
      );
      lines.push(
        `        inputs.${field(config, m, 'supplyCurrentAmps')} = m_${n}SupplyCurrent.getValueAsDouble();`,
      );
      return lines.join('\n');
    })
    .join('\n\n');

  const setters = config.mechanisms
    .map((m) => {
      const param = setterParam(m);
      let body: string;
      switch (quantity(m)) {
        case 'voltage':
          body = `${leadMotor(m)}.setControl(${requestField(m)}.withOutput(${param}));`;
          break;
        case 'velocity':
          body = `${leadMotor(m)}.setControl(${requestField(m)}.withVelocity(${param} / 60.0));`;
          break;
        default: {
          const conv =
            m.archetype === 'arm'
              ? `${m.name}DegreesToRotations(${param})`
              : `${m.name}MetersToRotations(${param})`;
          body = `${leadMotor(m)}.setControl(\n                ${requestField(m)}.withPosition(${conv}));`;
        }
      }
      return `    @Override\n    public void ${setterName(config, m)}(double ${param}) {\n        ${body}\n    }`;
    })
    .join('\n\n');

  const resetBody = config.mechanisms
    .filter(isPositional)
    .flatMap((m) => motorFields(m).map((f) => `        ${f}.setPosition(0.0);`))
    .join('\n');

  const stopBody = config.mechanisms
    .map((m) => `        ${leadMotor(m)}.stopMotor();`)
    .join('\n');

  const conversions = config.mechanisms
    .map((m) => conversionHelpers(config, m))
    .filter((c) => c !== '')
    .join('\n\n');

  const contents = `package ${pkg(config)};

${imports}

public class ${name}IOTalonFX implements ${name}IO {

${motors}

${requests}

${signals}

    public ${name}IOTalonFX() {
        configureMotors();
    }

    protected void configureMotors() {
${configureCalls}
    }

${configureMethods}

    @Override
    public void updateInputs(${name}Inputs inputs) {
${updateBlocks}
    }

${setters}
${
  anyPositional
    ? `\n    @Override\n    public void resetEncoder() {\n${resetBody}\n    }\n`
    : ''
}
    @Override
    public void stop() {
${stopBody}
    }

${conversions}
}
`;
  return { name: `${name}IOTalonFX.java`, contents };
}

// ---------------------------------------------------- XIOSimTalonFX.java

function simDeclaration(config: SubsystemConfig, mech: MechanismConfig): string {
  const c = (s: string) => `${config.name}Constants.${constant(config, mech, s)}`;
  const motor = dcMotorCall(mech);

  if (mech.archetype === 'roller') {
    return [
      `    private final FlywheelSim ${simField(mech)} = new FlywheelSim(`,
      `            LinearSystemId.createFlywheelSystem(`,
      `                    ${motor},`,
      `                    ${c('MOI')},`,
      `                    ${c('Reduction')}),`,
      `            ${motor});`,
    ].join('\n');
  }
  if (mech.archetype === 'arm') {
    return [
      `    private final SingleJointedArmSim ${simField(mech)} = new SingleJointedArmSim(`,
      `            ${motor},`,
      `            ${c('Reduction')},`,
      `            ${c('MOI')},`,
      `            ${c('LengthMeters')},`,
      `            Math.toRadians(${c('MinDegrees')}),`,
      `            Math.toRadians(${c('MaxDegrees')}),`,
      `            ${mech.simulateGravity},`,
      `            Math.toRadians(${c('MinDegrees')}));`,
    ].join('\n');
  }
  return [
    `    private final ElevatorSim ${simField(mech)} = new ElevatorSim(`,
    `            LinearSystemId.createElevatorSystem(`,
    `                    ${motor},`,
    `                    ${c('CarriageMassKg')},`,
    `                    ${c('DrumRadiusMeters')},`,
    `                    ${c('Reduction')}),`,
    `            ${motor},`,
    `            ${c('MinMeters')},`,
    `            ${c('MaxMeters')},`,
    `            ${mech.simulateGravity},`,
    `            ${c('MinMeters')});`,
  ].join('\n');
}

function simUpdateBlock(config: SubsystemConfig, mech: MechanismConfig): string {
  const c = (s: string) => `${config.name}Constants.${constant(config, mech, s)}`;
  const n = mech.name;
  const sim = simField(mech);
  const state = `${n}State`;
  const lines: string[] = [];

  lines.push(`        TalonFXSimState ${state} = ${leadMotor(mech)}.getSimState();`);
  lines.push(`        ${state}.setSupplyVoltage(batteryVoltage);`);
  mech.motors.forEach((_, i) => {
    if (i === 0) return;
    lines.push(
      `        ${followerMotor(mech, i)}.getSimState().setSupplyVoltage(batteryVoltage);`,
    );
  });
  lines.push('');
  lines.push(
    `        double ${n}AppliedVolts = ${state}.getMotorVoltageMeasure().baseUnitMagnitude();`,
  );
  lines.push(`        ${sim}.setInputVoltage(${n}AppliedVolts);`);
  lines.push(`        ${sim}.update(kSimLoopPeriodSeconds);`);
  lines.push('');

  if (mech.archetype === 'roller') {
    lines.push(`        double ${n}VelocityRPM = ${sim}.getAngularVelocityRPM();`);
    lines.push(
      `        ${state}.setRotorVelocity(${n}VelocityRPM / 60.0 * ${c('Reduction')});`,
    );
    lines.push('');
    lines.push(`        inputs.${measureField(config, mech)} = ${n}VelocityRPM;`);
  } else if (mech.archetype === 'arm') {
    lines.push(`        double ${n}Degrees = Math.toDegrees(${sim}.getAngleRads());`);
    lines.push(
      `        double ${n}DegreesPerSecond =\n                Math.toDegrees(${sim}.getVelocityRadPerSec());`,
    );
    lines.push(
      `        ${state}.setRawRotorPosition(${n}Degrees / 360.0 * ${c('Reduction')});`,
    );
    lines.push(
      `        ${state}.setRotorVelocity(${n}DegreesPerSecond / 360.0 * ${c('Reduction')});`,
    );
    lines.push('');
    lines.push(`        inputs.${measureField(config, mech)} = ${n}Degrees;`);
  } else {
    lines.push(`        double ${n}Meters = ${sim}.getPositionMeters();`);
    lines.push(
      `        double ${n}MetersPerSecond = ${sim}.getVelocityMetersPerSecond();`,
    );
    lines.push(
      `        ${state}.setRawRotorPosition(\n                ${n}Meters\n                        / ${c('DrumCircumferenceMeters')}\n                        * ${c('Reduction')});`,
    );
    lines.push(
      `        ${state}.setRotorVelocity(\n                ${n}MetersPerSecond\n                        / ${c('DrumCircumferenceMeters')}\n                        * ${c('Reduction')});`,
    );
    lines.push('');
    lines.push(`        inputs.${measureField(config, mech)} = ${n}Meters;`);
  }

  lines.push(`        inputs.${field(config, mech, 'appliedVolts')} = ${n}AppliedVolts;`);
  lines.push(
    `        inputs.${field(config, mech, 'statorCurrentAmps')} = ${state}.getTorqueCurrent();`,
  );
  lines.push(
    `        inputs.${field(config, mech, 'supplyCurrentAmps')} = ${state}.getSupplyCurrent();`,
  );
  mech.motors.forEach((_, i) => {
    const motorField = i === 0 ? leadMotor(mech) : followerMotor(mech, i);
    lines.push(
      `        inputs.${connectedField(config, mech, i)} = ${motorField}.isConnected();`,
    );
  });
  return lines.join('\n');
}

function generateSim(config: SubsystemConfig): GeneratedFile {
  const { name } = config;
  const archetypes = new Set(config.mechanisms.map((m) => m.archetype));
  const anyPositional = config.mechanisms.some(isPositional);
  const needsLinearSystemId = archetypes.has('roller') || archetypes.has('elevator');

  const simImports = [
    ...(archetypes.has('roller') ? ['edu.wpi.first.wpilibj.simulation.FlywheelSim'] : []),
    ...(archetypes.has('arm')
      ? ['edu.wpi.first.wpilibj.simulation.SingleJointedArmSim']
      : []),
    ...(archetypes.has('elevator') ? ['edu.wpi.first.wpilibj.simulation.ElevatorSim'] : []),
  ];

  const imports = [
    'com.ctre.phoenix6.sim.ChassisReference',
    'com.ctre.phoenix6.sim.TalonFXSimState',
    'edu.wpi.first.math.system.plant.DCMotor',
    ...(needsLinearSystemId ? ['edu.wpi.first.math.system.plant.LinearSystemId'] : []),
    'edu.wpi.first.wpilibj.RobotController',
    ...simImports,
    'frc.robot.util.CtreUtil',
    `${pkg(config)}.${name}.${name}Constants`,
  ]
    .sort()
    .map((i) => `import ${i};`)
    .join('\n');

  const sims = config.mechanisms.map((m) => simDeclaration(config, m)).join('\n\n');

  const simConfigure = config.mechanisms
    .flatMap((m) =>
      motorFields(m).map((f, i) => {
        const reference =
          i === 0
            ? m.invertLead === 'Clockwise_Positive'
              ? 'Clockwise_Positive'
              : 'CounterClockwise_Positive'
            : m.motors[i].alignment === 'Opposed'
              ? m.invertLead === 'Clockwise_Positive'
                ? 'CounterClockwise_Positive'
                : 'Clockwise_Positive'
              : m.invertLead === 'Clockwise_Positive'
                ? 'Clockwise_Positive'
                : 'CounterClockwise_Positive';
        return `        CtreUtil.${simConfigureCall(m)}(\n                ${f}.getSimState(), ChassisReference.${reference});`;
      }),
    )
    .join('\n');

  const updates = config.mechanisms
    .map((m) => simUpdateBlock(config, m))
    .join('\n\n');

  const resetBody = config.mechanisms
    .filter(isPositional)
    .map((m) => {
      const c = (s: string) => `${name}Constants.${constant(config, m, s)}`;
      return m.archetype === 'arm'
        ? `        ${simField(m)}.setState(Math.toRadians(${c('MinDegrees')}), 0.0);`
        : `        ${simField(m)}.setState(${c('MinMeters')}, 0.0);`;
    })
    .join('\n');

  const contents = `package ${pkg(config)};

${imports}

public class ${name}IOSimTalonFX extends ${name}IOTalonFX {

    private static final double kSimLoopPeriodSeconds = 0.02;

${sims}

    public ${name}IOSimTalonFX() {
        super();
        configureSim();
    }

    private void configureSim() {
${simConfigure}
    }

    @Override
    public void updateInputs(${name}Inputs inputs) {
        double batteryVoltage = RobotController.getBatteryVoltage();

${updates}
    }
${
  anyPositional
    ? `\n    @Override\n    public void resetEncoder() {\n        super.resetEncoder();\n${resetBody}\n    }\n`
    : ''
}}
`;
  return { name: `${name}IOSimTalonFX.java`, contents };
}

// ------------------------------------------------- RobotVisualizer snippets

export interface Snippet {
  label: string;
  target: string;
  code: string;
}

export function generateVisualizerSnippets(rawConfig: SubsystemConfig): Snippet[] {
  const config = normalizeConfig(rawConfig);
  const { name, visualizer: viz } = config;
  if (!viz.enabled) return [];

  const upper = name.toUpperCase();
  const lower = name.toLowerCase();
  const driven = config.mechanisms.find((m) => m.name === viz.drivenBy);
  const isArm = driven?.archetype === 'arm';
  const snippets: Snippet[] = [];

  if (viz.mechanism2d) {
    snippets.push({
      label: '2D root',
      target: 'the Mechanism2d roots block',
      code: `    private static final MechanismRoot2d ${upper}_BASE = MECH_VISUALIZER.getRoot(
            "${lower}-base",
            BASE_X + Units.inchesToMeters(${d(viz.rootXInches)}),
            Units.inchesToMeters(${d(viz.rootYInches)}));`,
    });
    snippets.push({
      label: '2D add method',
      target: 'the add* methods, near addIntake()',
      code: `    /** No-op on a real robot. */
    public static void add${name}(MechanismLigament2d ${lower}) {
        if (!IS_SIM) {
            return;
        }
        ${upper}_BASE.append(${lower});
    }`,
    });
  }

  if (viz.advantageScope3d) {
    snippets.push({
      label: '3D constants',
      target: 'the component index and pose constants block',
      code: `    private static final int ${upper}_COMPONENT = ${viz.componentIndex};

    private static final Pose3d ${upper}_LOCATION = new Pose3d(
            Units.inchesToMeters(${d(viz.poseXInches)}),
            Units.inchesToMeters(${d(viz.poseYInches)}),
            Units.inchesToMeters(${d(viz.poseZInches)}),
            new Rotation3d(0.0, 0.0, 0.0));`,
    });
    snippets.push({
      label: '3D COMPONENTS entry',
      target: 'the COMPONENTS array — order must match model_N.glb',
      code: `    // Insert at index ${viz.componentIndex} of COMPONENTS:
    //     ${upper}_LOCATION`,
    });
    snippets.push({
      label: '3D update method',
      target: 'the 3D update methods',
      code: isArm
        ? `    /** Updates the ${lower} angle. The input is radians. No-op on a real robot. */
    public static void update${name}(double angleRadians) {
        if (!IS_SIM) {
            return;
        }
        COMPONENTS[${upper}_COMPONENT] = ${upper}_LOCATION.transformBy(
                new Transform3d(
                        Translation3d.kZero,
                        new Rotation3d(0.0, angleRadians, 0.0)));
        publishComponents();
    }`
        : `    /** Updates the ${lower} travel. The input is meters. No-op on a real robot. */
    public static void update${name}(double extensionMeters) {
        if (!IS_SIM) {
            return;
        }
        COMPONENTS[${upper}_COMPONENT] = ${upper}_LOCATION.transformBy(
                new Transform3d(
                        new Translation3d(extensionMeters, 0.0, 0.0),
                        new Rotation3d(0.0, 0.0, 0.0)));
        publishComponents();
    }`,
    });
  }

  return snippets;
}

// ------------------------------------------------------------------- public

export function generateAll(rawConfig: SubsystemConfig): GeneratedFile[] {
  // Normalize here too, so a config that reaches the generator by any route
  // (import, storage, a future caller) can never emit mismatched code.
  const config = normalizeConfig(rawConfig);
  return [
    generateSubsystem(config),
    generateIO(config),
    generateTalonFX(config),
    generateSim(config),
  ];
}
