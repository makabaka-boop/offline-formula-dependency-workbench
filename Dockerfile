FROM node:20-alpine

WORKDIR /app

# 先拷贝依赖清单，尽量利用构建缓存
COPY package.json package-lock.json* ./

# 仅安装依赖（构建镜像时联网一次；运行期不访问外网）
RUN npm install

# 再拷贝源码
COPY . .

EXPOSE 5173

# 纯前端 Vite 开发服务器，数据与计算全部在浏览器本地完成
CMD ["npm", "run", "dev"]
