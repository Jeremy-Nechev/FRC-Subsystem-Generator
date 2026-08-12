import type { MechanismConfig, SubsystemConfig } from './types';
import { ARCHETYPES } from './types';

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** SCREAMING_SNAKE for CAN id constants: "roller" -> "ROLLER". */
export const screaming = (s: string) =>
  s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();

/**
 * Whether generated inputs, IO methods, constants and getters carry the
 * mechanism name. Motor and sim field names always carry it regardless — that
 * matches both the multi-mechanism Intake and the single-mechanism Flywheel.
 */
export const usesPrefix = (config: SubsystemConfig) =>
  !(config.omitPrefixWhenSingle && config.mechanisms.length === 1);

/** rollerVelocityRPM (prefixed) vs velocityRPM (not). */
export function field(
  config: SubsystemConfig,
  mech: MechanismConfig,
  suffix: string,
): string {
  return usesPrefix(config) ? `${mech.name}${cap(suffix)}` : lowerFirst(suffix);
}

/** kRollerP (prefixed) vs kP (not). */
export function constant(
  config: SubsystemConfig,
  mech: MechanismConfig,
  suffix: string,
): string {
  return usesPrefix(config) ? `k${cap(mech.name)}${cap(suffix)}` : `k${cap(suffix)}`;
}

/** setRollerVelocity (prefixed) vs setVelocity (not). */
export function method(
  config: SubsystemConfig,
  mech: MechanismConfig,
  verb: string,
  noun: string,
): string {
  return usesPrefix(config)
    ? `${verb}${cap(mech.name)}${cap(noun)}`
    : `${verb}${cap(noun)}`;
}

/**
 * The noun a mechanism's setter and inputs are built around. The archetype
 * wins over the control request: a positional mechanism is always commanded by
 * position, so a stale VoltageOut can never turn an arm into a voltage
 * mechanism.
 */
export function quantity(mech: MechanismConfig): 'velocity' | 'position' | 'voltage' {
  if (ARCHETYPES[mech.archetype].positional) return 'position';
  return mech.control === 'VoltageOut' ? 'voltage' : 'velocity';
}

/** rollerVelocityRPM / extensionPositionMeters / hoodPositionDegrees */
export function measureField(config: SubsystemConfig, mech: MechanismConfig): string {
  return field(config, mech, lowerFirst(ARCHETYPES[mech.archetype].unitSuffix));
}

export const leadMotor = (mech: MechanismConfig) =>
  mech.motors.length === 1 ? `m_${mech.name}Motor` : `m_${mech.name}LeadMotor`;

export const followerMotor = (mech: MechanismConfig, index: number) =>
  mech.motors.length === 2
    ? `m_${mech.name}FollowerMotor`
    : `m_${mech.name}FollowerMotor${index}`;

/** Status signal name for a follower's applied voltage (connectivity check). */
export const followerVoltageSignal = (mech: MechanismConfig, index: number) =>
  mech.motors.length === 2
    ? `m_${mech.name}FollowerAppliedVoltage`
    : `m_${mech.name}Follower${index}AppliedVoltage`;

/** All motor field names, lead first. */
export const motorFields = (mech: MechanismConfig) =>
  mech.motors.map((_, i) => (i === 0 ? leadMotor(mech) : followerMotor(mech, i)));

export const leadIdConstant = (mech: MechanismConfig, single: boolean) =>
  single
    ? `k${screaming(mech.name)}_MOTOR_ID`
    : `k${screaming(mech.name)}_LEAD_MOTOR_ID`;

export const followerIdConstant = (mech: MechanismConfig, index: number) =>
  mech.motors.length === 2
    ? `k${screaming(mech.name)}_FOLLOWER_MOTOR_ID`
    : `k${screaming(mech.name)}_FOLLOWER_MOTOR_${index}_ID`;

/** CAN id constant names, lead first. */
export const motorIdConstants = (mech: MechanismConfig) =>
  mech.motors.map((_, i) =>
    i === 0
      ? leadIdConstant(mech, mech.motors.length === 1)
      : followerIdConstant(mech, i),
  );

/** rollerLeadMotorConnected, or rollerMotorConnected when there's only one. */
export function connectedField(
  config: SubsystemConfig,
  mech: MechanismConfig,
  index: number,
): string {
  if (mech.motors.length === 1) return field(config, mech, 'motorConnected');
  if (index === 0) return field(config, mech, 'leadMotorConnected');
  return mech.motors.length === 2
    ? field(config, mech, 'followerMotorConnected')
    : field(config, mech, `followerMotor${index}Connected`);
}

export const simField = (mech: MechanismConfig) => `${mech.name}Sim`;

export const dcMotorCall = (mech: MechanismConfig) =>
  `DCMotor.get${mech.motorModel}(${mech.motors.length})`;

export const simConfigureCall = (mech: MechanismConfig) =>
  `configure${mech.motorModel}Sim`;

/** Java literal for a double, always with a decimal point. */
export function d(value: number): string {
  if (!Number.isFinite(value)) return '0.0';
  const s = String(value);
  return s.includes('.') || s.includes('e') || s.includes('E') ? s : `${s}.0`;
}

/** Emits `lhs = rhs;` on one line, wrapping the value if it would run long. */
export function assign(indentSpaces: number, lhs: string, rhs: string): string {
  const pad = ' '.repeat(indentSpaces);
  const oneLine = `${pad}${lhs} = ${rhs};`;
  if (oneLine.length <= 100) return oneLine;
  return `${pad}${lhs} =\n${pad}        ${rhs};`;
}

export const indent = (text: string, spaces: number) => {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.trim() === '' ? line : pad + line))
    .join('\n');
};
