variable "cluster_name" { type = string }
variable "container_image" { type = string }
variable "desired_count" { type = number default = 1 }
variable "subnet_ids" { type = list(string) }
variable "security_group_ids" { type = list(string) }
variable "cpu" { type = number default = 512 }
variable "memory" { type = number default = 1024 }
variable "environment" { type = map(string) default = {} }

resource "aws_ecs_cluster" "this" {
  name = var.cluster_name
}

resource "aws_ecs_task_definition" "this" {
  family                   = "mcp-gateway"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = tostring(var.cpu)
  memory                   = tostring(var.memory)
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "gateway"
      image     = var.container_image
      essential = true
      portMappings = [{ containerPort = 8000, protocol = "tcp" }]
      environment = [for k, v in var.environment : { name = k, value = v }]
    }
  ])
}

resource "aws_iam_role" "execution" {
  name = "mcp-gateway-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "task" {
  name = "mcp-gateway-task"
  assume_role_policy = aws_iam_role.execution.assume_role_policy
}

resource "aws_ecs_service" "this" {
  name            = "mcp-gateway"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.subnet_ids
    security_groups = var.security_group_ids
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.gateway.arn
    container_name   = "gateway"
    container_port   = 8000
  }
}

resource "aws_lb" "gateway" {
  name               = "mcp-gateway"
  internal           = false
  load_balancer_type = "application"
  security_groups    = var.security_group_ids
  subnets            = var.subnet_ids
}

resource "aws_lb_target_group" "gateway" {
  name     = "mcp-gateway"
  port     = 8000
  protocol = "HTTP"
  vpc_id   = data.aws_vpc.selected.id
  target_type = "ip"
  health_check {
    path                = "/health"
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 3
    unhealthy_threshold = 3
  }
}

data "aws_vpc" "selected" {
  id = var.vpc_id
}

variable "vpc_id" { type = string }

output "load_balancer_dns" {
  value = aws_lb.gateway.dns_name
}
