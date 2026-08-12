export type CanBus = 'UpperBus' | 'LowerBus';

export type MotorModel = 'KrakenX60' | 'KrakenX44';

/**
 * The three mechanism shapes we generate. The archetype picks the WPILib sim
 * model and the unit the mechanism is commanded in; the control request is a
 * separate (constrained) choice.
 */
export type Archetype = 'roller' | 'arm' | 'elevator';

export type ControlRequest =
  | 'VelocityVoltage'
  | 'VoltageOut'
  | 'PositionVoltage'
  | 'MotionMagicVoltage';

export type Alignment = 'Aligned' | 'Opposed';

export type NeutralMode = 'Brake' | 'Coast';

export type Inverted = 'Clockwise_Positive' | 'CounterClockwise_Positive';

export interface MotorConfig {
  canId: number;
  /** Ignored for the lead motor (index 0), which defines the direction. */
  alignment: Alignment;
}

export interface MechanismConfig {
  id: string;
  /** camelCase, prefixes every generated field and method: "roller" -> rollerVelocityRPM */
  name: string;
  archetype: Archetype;
  control: ControlRequest;
  motorModel: MotorModel;
  /** First entry is the lead motor; the rest are generated as Followers. */
  motors: MotorConfig[];
  reduction: number;
  /** kg m^2. Used by the roller and arm sim models. */
  moi: number;

  kP: number;
  kS: number;
  kV: number;
  kA: number;
  /** Arm only, and only when gravity is simulated. */
  kG: number;

  statorCurrentLimit: number;
  supplyCurrentLimit: number;
  neutralMode: NeutralMode;
  invertLead: Inverted;

  /** Positional archetypes only. Degrees for an arm, meters for an elevator. */
  minPosition: number;
  maxPosition: number;

  /** MotionMagicVoltage only. */
  cruiseVelocity: number;
  acceleration: number;

  /** Arm only. */
  armLengthMeters: number;
  simulateGravity: boolean;

  /** Elevator only. */
  drumRadiusMeters: number;
  carriageMassKg: number;

  /** Drives the auto-generated TEST_FORWARD / TEST_REVERSE states. */
  testVelocityRPM: number;
  testVolts: number;
}

export interface VisualizerConfig {
  enabled: boolean;
  mechanism2d: boolean;
  advantageScope3d: boolean;
  /** Name of the mechanism whose position drives the drawing. */
  drivenBy: string;

  ligamentLengthInches: number;
  ligamentAngleDegrees: number;
  ligamentWidth: number;
  /** "r, g, b" passed straight into Color8Bit. */
  color: string;
  rootXInches: number;
  rootYInches: number;

  /** Index into RobotVisualizer.COMPONENTS, matching model_N.glb ordering. */
  componentIndex: number;
  poseXInches: number;
  poseYInches: number;
  poseZInches: number;
}

export interface SubsystemConfig {
  /** PascalCase, e.g. "Intake". Drives every generated class name. */
  name: string;
  packageRoot: string;
  canBus: CanBus;
  mechanisms: MechanismConfig[];
  /**
   * When a subsystem has exactly one mechanism, drop the name prefix from
   * fields and methods (velocityRPM instead of flywheelVelocityRPM), matching
   * the existing Flywheel/Hood style.
   */
  omitPrefixWhenSingle: boolean;
  visualizer: VisualizerConfig;
}

interface ArchetypeMeta {
  label: string;
  /** Suffix on the generated position/velocity input field. */
  unitSuffix: string;
  /** Human-facing unit, shown in the form. */
  unitLabel: string;
  positional: boolean;
  controls: ControlRequest[];
  simClass: string;
}

export const ARCHETYPES: Record<Archetype, ArchetypeMeta> = {
  roller: {
    label: 'Roller / flywheel',
    unitSuffix: 'VelocityRPM',
    unitLabel: 'RPM',
    positional: false,
    controls: ['VelocityVoltage', 'VoltageOut'],
    simClass: 'FlywheelSim',
  },
  arm: {
    label: 'Arm',
    unitSuffix: 'PositionDegrees',
    unitLabel: 'deg',
    positional: true,
    controls: ['MotionMagicVoltage', 'PositionVoltage'],
    simClass: 'SingleJointedArmSim',
  },
  elevator: {
    label: 'Elevator / extension',
    unitSuffix: 'PositionMeters',
    unitLabel: 'm',
    positional: true,
    controls: ['MotionMagicVoltage', 'PositionVoltage'],
    simClass: 'ElevatorSim',
  },
};

/** The states the generator always emits, for bring-up testing. */
export const TEST_STATES = ['IDLE', 'TEST_FORWARD', 'TEST_REVERSE'] as const;
