use crate::models::{RuntimeStatus, RuntimeStatusValue};
use crate::runtime_engine::{inspect_runtime_layout, RuntimeLayout};

#[derive(Clone)]
pub struct RuntimeSupervisor {
    status: RuntimeStatus,
}

impl RuntimeSupervisor {
    pub fn new(status: RuntimeStatus) -> Self {
        Self { status }
    }

    pub async fn probe(layout: RuntimeLayout) -> Self {
        let inspected = inspect_runtime_layout(&layout);
        if inspected.status != RuntimeStatusValue::Ready {
            return Self::new(inspected);
        }

        Self::new(RuntimeStatus {
            status: RuntimeStatusValue::Ready,
            detail: inspected.detail,
            runtime_root: inspected.runtime_root,
            binary_path: inspected.binary_path,
            compat: inspected.compat,
        })
    }

    pub fn status(&self) -> RuntimeStatus {
        self.status.clone()
    }
}
