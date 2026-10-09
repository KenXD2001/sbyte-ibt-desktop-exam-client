//! Native networking: exam_server (REST) + websocket + connectivity.
//! Stubs only — fill in alongside docs/api/contracts.md.
//! Split a submodule into its own directory when it passes ~200 lines
//! or gains a 2nd subdomain (per docs/architecture/rust.md).

pub mod connectivity {
    // ponytail: stub, add reachability probe when offline mode is specced
}

pub mod exam_server {
    // ponytail: stub, add reqwest client + auth/exams/attempts here
}

pub mod websocket {
    // ponytail: stub, add client + reconnect backoff here
}
