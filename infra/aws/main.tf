provider "aws" {
  region = var.region
}

module "network" {
  source          = "./modules/network"
  vpc_cidr        = var.vpc_cidr
  public_subnet_cidrs = var.public_subnet_cidrs
}

resource "aws_security_group" "alb" {
  name        = "mcp-gateway-alb"
  description = "Allow HTTP"
  vpc_id      = module.network.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

module "ecs_service" {
  source             = "./modules/ecs_service"
  cluster_name       = var.cluster_name
  container_image    = var.container_image
  desired_count      = var.desired_count
  subnet_ids         = module.network.public_subnet_ids
  security_group_ids = [aws_security_group.alb.id]
  vpc_id             = module.network.vpc_id
  environment        = var.environment
}

output "load_balancer_dns" {
  value = module.ecs_service.load_balancer_dns
}
