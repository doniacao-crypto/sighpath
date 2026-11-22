"use client";

/** A camera the operator can pick from. */
export interface CameraOption {
  deviceId: string;
  label: string;
}

export interface HomeStageProps {
  cameras: CameraOption[];
  deviceId: string | null;
  /** True once a calibration has produced a gaze model. */
  hasModel: boolean;
  onDeviceChange(deviceId: string): void;
  onStartCalibration(): void;
  onStartTest(): void;
  /** The operator wants to run one of the other protocols. */
  onStartProtocol(protocol: "saccade" | "fixation" | "validation"): void;
  onShowHistory(): void;
}

export function HomeStage({
  cameras,
  deviceId,
  hasModel,
  onDeviceChange,
  onStartCalibration,
  onStartTest,
  onStartProtocol,
  onShowHistory,
}: HomeStageProps) {
  return (
    <section className="sp-card">
      <h1 className="sp-title">SightPath</h1>
      <p className="sp-lead">
        Webcam-based assessment of smooth pursuit: calibrate the tracker on the
        patient, then run the pursuit test and read the measurements.
      </p>

      <div className="sp-notice sp-notice--warn">
        <span className="sp-notice-title">Not clinically validated</span>
        <p>
          The thresholds used by SightPath are provisional. They come from
          development work and have not been validated against a clinical
          reference, so the numbers must not be used for diagnosis or treatment
          decisions.
        </p>
      </div>

      {!hasModel && (
        <div
          className="sp-notice sp-notice--info"
          style={{ marginTop: "1rem" }}
        >
          <span className="sp-notice-title">Calibrate first</span>
          <p>
            No gaze model is fitted yet. Run the calibration first — the test
            cannot measure anything until the tracker knows where the patient is
            looking.
          </p>
        </div>
      )}

      {cameras.length > 1 && (
        <div className="sp-field-row">
          <div className="sp-field">
            <label className="sp-label" htmlFor="sp-camera-select">
              Camera
            </label>
            <select
              id="sp-camera-select"
              className="sp-select"
              value={deviceId ?? ""}
              onChange={(event) => onDeviceChange(event.target.value)}
            >
              {cameras.map((camera) => (
                <option key={camera.deviceId} value={camera.deviceId}>
                  {camera.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="sp-actions">
        <button
          type="button"
          className="sp-button sp-button--primary"
          onClick={onStartCalibration}
        >
          Start calibration
        </button>
        <button
          type="button"
          className="sp-button"
          onClick={onStartTest}
          disabled={!hasModel}
          title={hasModel ? undefined : "Calibrate before running a test"}
        >
          Run a pursuit test
        </button>
        <button type="button" className="sp-button" onClick={onShowHistory}>
          View history
        </button>
      </div>

      <h3 className="sp-subtitle" style={{ marginTop: "1.5rem" }}>
        Other measurements
      </h3>
      <p className="sp-small sp-text-dim">
        The same protocols the desktop app runs, in the browser.
      </p>
      <div className="sp-actions">
        <button
          type="button"
          className="sp-button"
          onClick={() => onStartProtocol("saccade")}
          disabled={!hasModel}
          title={hasModel ? undefined : "Calibrate before running a test"}
        >
          Saccade test
        </button>
        <button
          type="button"
          className="sp-button"
          onClick={() => onStartProtocol("fixation")}
          disabled={!hasModel}
          title={hasModel ? undefined : "Calibrate before running a test"}
        >
          Fixation stability
        </button>
        <button
          type="button"
          className="sp-button"
          onClick={() => onStartProtocol("validation")}
          disabled={!hasModel}
          title={hasModel ? undefined : "Calibrate before running a test"}
        >
          Gaze accuracy validation
        </button>
      </div>

      {cameras.length > 1 && (
        <p className="sp-small sp-text-dim" style={{ marginTop: "1rem" }}>
          Pick the camera that faces the patient. The choice is remembered on
          this computer.
        </p>
      )}
    </section>
  );
}
