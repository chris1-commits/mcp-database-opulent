variable "region" { type = string }
variable "vpc_cidr" { type = string default = "10.20.0.0/16" }
variable "public_subnet_cidrs" { type = list(string) default = ["10.20.1.0/24", "10.20.2.0/24"] }
variable "cluster_name" { type = string default = "mcp-gateway" }
variable "container_image" { type = string }
variable "desired_count" { type = number default = 1 }
variable "environment" { type = map(string) default = {} }
