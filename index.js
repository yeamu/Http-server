#!/usr/bin/env node

const fs = require('node:fs')
const fsp = fs.promises
const http = require('node:http')
const path = require('node:path')
const mime = require('mime')
const { filesize } = require('filesize')
const dayjs = require('dayjs')

console.log(process.pid)

const port = process.argv[2] || 8000
const publicDir = process.cwd()



const server = http.createServer()

server.on('request', async (req, res) => {
  console.log(req.method, decodeURIComponent(req.url))

  // 构造一个URL对象以提取其中的各个部分
  var url = new URL(req.url, 'http://localhost/')
  var pathname = url.pathname
  var decodedPathname = decodeURIComponent(pathname)/* 将请求路径解码,因为其中的中文和特殊符号会被编码 */

  var targetPath = path.join(publicDir, decodedPathname)
  console.log('target path:', targetPath)

  // 判断最终的目标路径是否在publicDir里面，如果不在，则结束
  if (!targetPath.startsWith(publicDir)) {
    res.writeHead(404)
    res.end('404 Not Found')
    return
  }

  try {
    let stat = await fsp.stat(targetPath)
    if (stat.isFile()) {
      // 流式处理而不是将文件一次性读出后发送出去
      res.writeHead(200, {
        'Content-Type': mime.getType(targetPath)
      })
      fs.createReadStream(targetPath).pipe(res)

      // let content = await fsp.readFile(targetPath)
      // res.writeHead(200, {
      //   'Content-Type': mime.getType(targetPath) ?? 'application/octet-stream'
      // })
      // res.end(content)

    } else if (stat.isDirectory()) {
      if (!pathname.endsWith('/')) {
        res.writeHead(302, {
          Location: pathname + '/' + url.search
        })
        return
      }

      let indexPath = path.join(targetPath, 'index.html')
      try {
        var indexStat = await fsp.stat(indexPath)
        if (indexStat.isFile()) {
          // let indexContent = await fsp.readFile(indexPath)
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=UTF-8',
            // 'Content-Encoding': 'gzip',
          })
          fs.createReadStream(indexPath)
            // .pipe(compress)
            .pipe(res)
          // res.end(indexContent)
          return
        }
      } catch (e) { }

      let entries = await fsp.readdir(targetPath, {withFileTypes: true} /** 加上这个选项参数表示不只读取文件名,还要读文件状态 */)

      entries.sort((a, b) => {
        // 把文件当作数字,文件是1,文件夹是0
        // 那么升序排列就能让文件夹在前
        var aa = a.isFile() ? 1 : 0
        var bb = b.isFile() ? 1 : 0
        return aa - bb
      })

      // 由所有文件的名字得到其状态
      // 之所以用allSettled是因为里边的stat函数返回的Promise可能失败
      // 但此时它返回的就不再是由promise的结果组成的数组了
      // 而是这种形态的数组：[{status: "fulfilled": value:xxx}, {status:"rejected", reason: yyy}]
      let stats = await Promise.allSettled(entries.map(entry => {
        // 文件条目得到获取文件信息的Promise
        return fsp.stat(path.join(targetPath, entry.name))
      }))


      res.writeHead(200, {
        'Content-Type': 'text/html; charset=UTF-8'
      })
      res.write(`<h1>Index of ${decodedPathname}</h1>`)
      res.write(`
        <style>
          td {
            padding-left: 1em;
          }
        </style>
      `)
      res.write('<pre><table>')
      for (let i = 0; i < entries.length; i++) {
        let entry = entries[i]
        let stat = stats[i]

        var sep = entry.isDirectory() ? '/' : ''
        var name = entry.name + sep


        if (stat.status == 'fulfilled') {
          var day = dayjs(stat.value.mtime) // 通过文件的修改时间的日期对象创建一个dayjs对象
          res.write(`<div><a href="${name}">${name}</a></div>`)
          // res.write(`<tr><td>${day.format('YYYY-MM-DD HH:mm:ss')}</td><td style="text-align: right;">${filesize(stat.value.size)}</td><td><a href="${name}>${name}</a></td></tr>`)
        } else {
          // res.write(`<tr><td>!</td>  <td style="text-align: right;">!</td>  <td><a href="${name}">${name}</a></td>  </tr>`)
        }
      }
      res.write('</table></pre>')
      res.write(`<p>Node.js ${process.version}/ http-server server running @ ${req.headers.host}</p>`)
      res.end()
    }
  } catch (e) {
    if (e.code == 'ENOENT') {
      res.writeHead(404)
      res.end('404 Not Found')
    } else {
      res.end(String(e))
    }
  }

  return
  fs.stat(targetPath, (err, stat) => {
    if (err) {
      if (err.code == 'ENOENT') {
        res.writeHead(404) // 设置响应状态码
        res.end("404 Not Found")
      } else {
        res.end(String(err))
      }
    } else {
      if (stat.isFile()) {
        fs.readFile(targetPath, (err, result) => {
          if (err) {
            res.end(String(err))
          } else {
            res.end(result)
          }
        })
      } else if (stat.isDirectory()) {
        // 先判断请求地址的路径部分（不含查询字符串）是否以斜杠结尾
        if (!pathname.endsWith('/')) {
          // 如果不以斜杠结尾，则跳转
          res.writeHead(302, {
            Location: pathname + '/' + url.search // 这里不用加上url.hash，因为hash不会被浏览器发到服务器
          })
          res.end()
          return
        }
        // 先看文件夹里有没有index.html，如果有，相应这个文件，否则才列出文件夹内容
        let indexPath = path.join(targetPath, 'index.html')

        fs.stat(indexPath, (err, stat) => {
          if (stat && stat.isFile()) {
            fs.readFile(indexPath, (err, result) => {
              res.writeHead(200, {
                'Content-Type': 'text/html; charset=UTF-8'
              })
              res.end(result)
            })
          } else {
            // 列出文件夹里的内容
            fs.readdir(targetPath, {withFileTypes: true}, (err, entries) => {
              if (err) {
                res.end(String(err))
              } else {
                // 对结果进行排序,将文件夹放前,文件放后
                entries.sort((a, b) => {
                  if (a.isFile() && b.isFile() || a.isDirectory() && b.isDirectory()) {
                    return 0
                  } else {
                    if (a.isFile() && b.isDirectory()) {
                      return 1
                    }
                    if (a.isDirectory() && b.isFile()) {
                      return -1
                    }
                  }
                })

                res.writeHead(200, {
                  'Content-Type': 'text/html; charset=UTF-8'
                })
                res.write(`<h1>Index of ${pathname}</h1>`)
                for (let entry of entries) {
                  let sep = entry.isDirectory() ? '/' : ''
                  let name = entry.name + sep
                  res.write(`<div><a href="${path.posix.join(req.url, name)}">${name}</a></div>`)
                }
                res.end()
              }
            })
          }
        })
      }
    }
  })
})

server.listen(port, () => {
  console.log('server listening on port', port)
})
