use std::env;
use std::path::PathBuf;

use crawclaw_gateway::{run_gateway, GatewayBind, GatewayRunConfig};

#[tokio::main]
async fn main() {
    let mut bind = GatewayBind::Loopback;
    let mut port = 18789;
    let mut runtime_root: Option<PathBuf> = None;
    let args = env::args().skip(1).collect::<Vec<_>>();
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "--help" | "-h" => {
                print_help();
                return;
            }
            "--version" | "-V" => {
                println!("crawclaw-gateway {}", env!("CARGO_PKG_VERSION"));
                return;
            }
            "--bind" => {
                let Some(value) = args.get(index + 1) else {
                    exit_usage("--bind requires a value");
                };
                bind = parse_bind(value);
                index += 2;
            }
            "--port" => {
                let Some(value) = args.get(index + 1) else {
                    exit_usage("--port requires a value");
                };
                port = value
                    .parse::<u16>()
                    .unwrap_or_else(|_| exit_usage("--port must be a valid u16"));
                index += 2;
            }
            "--runtime-root" => {
                let Some(value) = args.get(index + 1) else {
                    exit_usage("--runtime-root requires a value");
                };
                runtime_root = Some(PathBuf::from(value));
                index += 2;
            }
            other => exit_usage(&format!("unsupported option: {other}")),
        }
    }

    let config = GatewayRunConfig {
        bind,
        port,
        runtime_root,
        ..GatewayRunConfig::default()
    };
    if let Err(error) = run_gateway(config).await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn parse_bind(value: &str) -> GatewayBind {
    match value {
        "127.0.0.1" | "localhost" | "loopback" => GatewayBind::Loopback,
        "0.0.0.0" | "lan" => GatewayBind::Lan,
        _ => exit_usage("--bind must be 127.0.0.1, localhost, loopback, 0.0.0.0, or lan"),
    }
}

fn exit_usage(message: &str) -> ! {
    eprintln!("{message}");
    print_help();
    std::process::exit(2);
}

fn print_help() {
    println!(
        "Usage: crawclaw-gateway [--bind 127.0.0.1|0.0.0.0] [--port PORT] [--runtime-root PATH]"
    );
}
