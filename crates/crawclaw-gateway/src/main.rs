#![recursion_limit = "256"]

use std::env;
use std::path::PathBuf;

use crawclaw_gateway::{call_local_gateway_method, run_gateway, GatewayBind, GatewayRunConfig};

#[tokio::main]
async fn main() {
    let mut bind = GatewayBind::Loopback;
    let mut port = 18789;
    let mut runtime_root: Option<PathBuf> = None;
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.first().map(String::as_str) == Some("call") {
        if let Err(error) = call_gateway_method(args.into_iter().skip(1).collect()).await {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
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

async fn call_gateway_method(args: Vec<String>) -> Result<(), String> {
    let mut method: Option<String> = None;
    let mut params = serde_json::Value::Object(serde_json::Map::new());
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--method" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("--method requires a value".to_string());
                };
                method = Some(value.clone());
                index += 2;
            }
            "--params-json" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("--params-json requires a value".to_string());
                };
                params = serde_json::from_str(value)
                    .map_err(|error| format!("invalid --params-json: {error}"))?;
                index += 2;
            }
            other => return Err(format!("unsupported call option: {other}")),
        }
    }
    let method = method.ok_or_else(|| "--method is required".to_string())?;
    let value = call_local_gateway_method(&method, params).await?;
    let raw =
        serde_json::to_string(&value).map_err(|error| format!("failed to encode JSON: {error}"))?;
    println!("{raw}");
    Ok(())
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
