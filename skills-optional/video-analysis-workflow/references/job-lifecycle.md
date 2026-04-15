# Video Analysis Workflow Job Lifecycle

Use this reference when you need to understand submission, dispatch, worker execution, retries, or task control.

## Main path

```text
run.sh submit
  -> submit_job.py
  -> dispatcher.py
  -> scene_worker.py
```

## Why this path is preferred

- submit returns quickly
- dispatcher owns scheduling
- each scene runs in an isolated worker path
- retries / pause / resume / cancel stay centralized

## Control actions

Typical commands:
- list
- status
- pause
- resume
- retry-failed
- cancel
- dispatcher

## Use this reference when

- explaining the async model
- diagnosing stuck jobs
- deciding whether a task belongs in foreground vs background mode
