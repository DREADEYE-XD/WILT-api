const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  // Create a user
  const user = await prisma.users.create({
    data: {
      sub: '123456',
      name: 'Test User',
      email: 'test@example.com',
    },
  })

  console.log('Created user:', user)

  // Create a task
  const task = await prisma.task.create({
    data: {
      from: '9:00',
      to: '10:00',
      duration: '1 hour',
      topic: 'Math',
      description: 'Studied algebra',
    },
  })

  console.log('Created task:', task)

  // Create a completed entry
  const completed = await prisma.completed.create({
    data: {
      sub: user.sub,
      date: new Date(),
      day: 'Monday',
      taskIds: [task.id],
    },
  })

  console.log('Created completed entry:', completed)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })